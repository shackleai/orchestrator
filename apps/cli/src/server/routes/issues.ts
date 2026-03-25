/**
 * Issue CRUD + checkout + delegate routes — /api/companies/:id/issues
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Issue } from '@shackleai/shared'
import { CreateIssueInput, UpdateIssueInput, DelegateIssueInput, UpdateChecklistInput } from '@shackleai/shared'
import { IssueStatus, TriggerType } from '@shackleai/shared'
import type { Scheduler } from '@shackleai/core'
import { DelegationService, DelegationError, rollUpParentStatus, checkHonestyGate } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function issuesRouter(db: DatabaseProvider, scheduler?: Scheduler): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/issues — list with filters (status, priority, assignee)
  app.get('/:id/issues', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { status, priority, assignee, label } = c.req.query()

    const conditions: string[] = ['i.company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (status) {
      conditions.push(`i.status = $${paramIndex++}`)
      params.push(status)
    }

    if (priority) {
      conditions.push(`i.priority = $${paramIndex++}`)
      params.push(priority)
    }

    if (assignee) {
      conditions.push(`i.assignee_agent_id = $${paramIndex++}`)
      params.push(assignee)
    }


    // Filter by label name � join through issue_labels + labels
    let joinClause = ''
    if (label) {
      joinClause = `INNER JOIN issue_labels il ON il.issue_id = i.id
                     INNER JOIN labels lbl ON lbl.id = il.label_id AND lbl.name = $${paramIndex++}`
      params.push(label)
    }

    const { limit, offset } = parsePagination(c)

    const where = conditions.join(' AND ')
    const result = await db.query<Issue>(
      `SELECT i.* FROM issues i ${joinClause} WHERE ${where} ORDER BY i.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues — create issue with atomic identifier generation
  app.post('/:id/issues', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateIssueInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { title, description, parent_id, goal_id, project_id, status, priority, assignee_agent_id, honesty_checklist } =
      parsed.data

    // Atomically increment company issue_counter and get prefix + new counter value
    const counterResult = await db.query<{ issue_prefix: string; issue_counter: number }>(
      `UPDATE companies SET issue_counter = issue_counter + 1 WHERE id = $1
       RETURNING issue_prefix, issue_counter`,
      [companyId],
    )

    if (counterResult.rows.length === 0) {
      return c.json({ error: 'Company not found' }, 404)
    }

    const { issue_prefix, issue_counter } = counterResult.rows[0]
    const identifier = `${issue_prefix}-${issue_counter}`

    const result = await db.query<Issue>(
      `INSERT INTO issues
         (company_id, identifier, issue_number, title, description, parent_id,
          goal_id, project_id, status, priority, assignee_agent_id, honesty_checklist)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        companyId,
        identifier,
        issue_counter,
        title,
        description ?? null,
        parent_id ?? null,
        goal_id ?? null,
        project_id ?? null,
        status,
        priority,
        assignee_agent_id ?? null,
        honesty_checklist ? JSON.stringify(honesty_checklist) : null,
      ],
    )

    // Trigger agent wake-up on task assignment
    if (assignee_agent_id && scheduler) {
      void scheduler.triggerNow(assignee_agent_id, TriggerType.TaskAssigned)
    }

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/issues/:issueId — issue detail with ancestry
  app.get('/:id/issues/:issueId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    const result = await db.query<
      Issue & {
        goal_name: string | null
        goal_description: string | null
        project_name: string | null
        project_description: string | null
        company_mission: string | null
      }
    >(
      `SELECT i.*,
              g.title AS goal_name, g.description AS goal_description,
              p.name AS project_name, p.description AS project_description,
              co.description AS company_mission
       FROM issues i
       LEFT JOIN goals g ON g.id = i.goal_id
       LEFT JOIN projects p ON p.id = COALESCE(i.project_id, (SELECT pr.id FROM projects pr WHERE pr.goal_id = i.goal_id LIMIT 1))
       LEFT JOIN companies co ON co.id = i.company_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [issueId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const row = result.rows[0]
    const ancestry = {
      mission: row.company_mission,
      project: row.project_name
        ? { name: row.project_name, description: row.project_description }
        : null,
      goal: row.goal_name
        ? { name: row.goal_name, description: row.goal_description }
        : null,
      task: { title: row.title, description: row.description },
    }

    // Strip joined columns from the issue response
    const { goal_name: _goal_name, goal_description: _goal_description, project_name: _project_name, project_description: _project_description, company_mission: _company_mission, ...issue } = row

    // Auto-mark as read when reader_id query param is provided
    const readerId = c.req.query('reader_id')
    if (readerId) {
      void db
        .query(
          `INSERT INTO issue_read_states (issue_id, user_or_agent_id, last_read_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (issue_id, user_or_agent_id)
           DO UPDATE SET last_read_at = NOW()`,
          [issueId, readerId],
        )
        .catch(() => {
          // Non-blocking
        })
    }

    return c.json({ data: { ...issue, ancestry } })
  })

  // PATCH /api/companies/:id/issues/:issueId — update status, priority, description, etc.
  app.patch('/:id/issues/:issueId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue exists and belongs to company; fetch old assignee for trigger comparison
    const existing = await db.query<Pick<Issue, 'id' | 'assignee_agent_id'>>(
      `SELECT id, assignee_agent_id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const oldAssignee = existing.rows[0].assignee_agent_id

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateIssueInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<Issue>(
        `SELECT * FROM issues WHERE id = $1 AND company_id = $2`,
        [issueId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    // Lifecycle guard: block completing a parent issue while children are incomplete
    const isTerminalStatus =
      updates.status === IssueStatus.Done || updates.status === IssueStatus.Cancelled
    if (isTerminalStatus) {
      const childResult = await db.query<
        Pick<Issue, 'id' | 'identifier' | 'title' | 'status'>
      >(
        `SELECT id, identifier, title, status FROM issues WHERE parent_id = $1`,
        [issueId],
      )
      const incompleteChildren = childResult.rows.filter(
        (child) =>
          child.status !== IssueStatus.Done &&
          child.status !== IssueStatus.Cancelled,
      )
      if (incompleteChildren.length > 0) {
        const childList = incompleteChildren
          .map(
            (child) =>
              `${child.identifier} "${child.title}" (${child.status})`,
          )
          .join(', ')
        return c.json(
          {
            error:
              'Cannot complete parent issue while children are incomplete',
            incomplete_children: incompleteChildren.map((child) => ({
              id: child.id,
              identifier: child.identifier,
              title: child.title,
              status: child.status,
            })),
            message: `Incomplete children: ${childList}`,
          },
          400,
        )
      }
    }

    // Honesty Gate: if transitioning to "done", verify checklist is complete
    if (updates.status === IssueStatus.Done) {
      const gate = await checkHonestyGate(db, issueId!, companyId!)
      if (!gate.passed) {
        return c.json(
          {
            error: 'Honesty gate check failed',
            reason: gate.reason,
            unchecked_items: gate.uncheckedItems ?? [],
          },
          400,
        )
      }
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => {
      const val = updates[f]
      // Serialize arrays/objects to JSON for JSONB columns
      if (f === 'honesty_checklist' && val !== null && val !== undefined) {
        return JSON.stringify(val)
      }
      return val
    })

    const result = await db.query<Issue>(
      `UPDATE issues SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [issueId, companyId, ...values],
    )

    // Trigger agent wake-up if assignee changed to a new agent
    const newAssignee = result.rows[0].assignee_agent_id
    if (scheduler && newAssignee && newAssignee !== oldAssignee) {
      void scheduler.triggerNow(newAssignee, TriggerType.TaskAssigned)
    }

    // Roll up parent status when a child issue is marked done
    const updatedIssue = result.rows[0]
    if (updatedIssue.status === IssueStatus.Done && updatedIssue.parent_id) {
      void rollUpParentStatus(db, updatedIssue.parent_id)
    }

    return c.json({ data: updatedIssue })
  })

  // POST /api/companies/:id/issues/:issueId/checkout — atomic claim
  // Returns 409 if already claimed by another agent
  app.post('/:id/issues/:issueId/checkout', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue exists and belongs to company first
    const existing = await db.query<Issue>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    const agentId =
      body && typeof body === 'object' && 'agent_id' in body && typeof body.agent_id === 'string'
        ? body.agent_id
        : null

    // Atomic checkout: only succeeds if unassigned and in backlog/todo
    const result = await db.query<Issue>(
      `UPDATE issues
       SET assignee_agent_id = $1, status = 'in_progress', started_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND company_id = $3
         AND assignee_agent_id IS NULL
         AND status IN ('backlog', 'todo')
       RETURNING *`,
      [agentId, issueId, companyId],
    )

    if (result.rows.length === 0) {
      // Issue exists but is already claimed or not in a checkable state
      return c.json({ error: 'Issue already claimed or not available for checkout' }, 409)
    }

    // Trigger agent wake-up on checkout assignment
    if (agentId && scheduler) {
      void scheduler.triggerNow(agentId, TriggerType.TaskAssigned)
    }

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/issues/:issueId/release — unassign + set status back to todo
  app.post('/:id/issues/:issueId/release', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    const result = await db.query<Issue>(
      `UPDATE issues
       SET assignee_agent_id = NULL, status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [IssueStatus.Todo, issueId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/issues/:issueId/delegate — delegate to a direct report
  app.post('/:id/issues/:issueId/delegate', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = DelegateIssueInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { from_agent_id, to_agent_id, sub_tasks } = parsed.data
    const delegationService = new DelegationService(db)

    try {
      const childIds = await delegationService.delegate(
        companyId,
        from_agent_id,
        issueId,
        to_agent_id,
        sub_tasks,
      )

      // Trigger the delegatee agent
      if (scheduler) {
        void scheduler.triggerNow(to_agent_id, TriggerType.Delegated)
      }

      return c.json({ data: { delegated: true, child_issue_ids: childIds } }, 201)
    } catch (err) {
      if (err instanceof DelegationError) {
        return c.json({ error: err.message }, 403)
      }
      throw err
    }
  })


  // PUT /api/companies/:id/issues/:issueId/checklist -- set or update honesty checklist
  app.put('/:id/issues/:issueId/checklist', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue exists and belongs to company
    const existing = await db.query<Pick<Issue, 'id'>>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateChecklistInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const result = await db.query<Issue>(
      `UPDATE issues SET honesty_checklist = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [JSON.stringify(parsed.data.items), issueId, companyId],
    )

    return c.json({ data: result.rows[0] })
  })

  return app
}
