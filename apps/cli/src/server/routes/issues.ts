/**
 * Issue CRUD + checkout + comments routes — /api/companies/:id/issues
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Issue, IssueComment } from '@shackleai/shared'
import { CreateIssueInput, UpdateIssueInput, CreateIssueCommentInput } from '@shackleai/shared'
import { IssueStatus, TriggerType } from '@shackleai/shared'
import type { Scheduler } from '@shackleai/core'
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
    const { status, priority, assignee } = c.req.query()

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (status) {
      conditions.push(`status = $${paramIndex++}`)
      params.push(status)
    }

    if (priority) {
      conditions.push(`priority = $${paramIndex++}`)
      params.push(priority)
    }

    if (assignee) {
      conditions.push(`assignee_agent_id = $${paramIndex++}`)
      params.push(assignee)
    }

    const { limit, offset } = parsePagination(c)

    const where = conditions.join(' AND ')
    const result = await db.query<Issue>(
      `SELECT * FROM issues WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
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

    const { title, description, parent_id, goal_id, project_id, status, priority, assignee_agent_id } =
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
          goal_id, project_id, status, priority, assignee_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    const { goal_name, goal_description, project_name, project_description, company_mission, ...issue } = row

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

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => updates[f])

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

    return c.json({ data: result.rows[0] })
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

  // POST /api/companies/:id/issues/:issueId/comments — add comment
  app.post('/:id/issues/:issueId/comments', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue belongs to company
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
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateIssueCommentInput.safeParse({ issue_id: issueId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { content, author_agent_id, parent_id, is_resolved } = parsed.data

    const result = await db.query<IssueComment>(
      `INSERT INTO issue_comments (issue_id, author_agent_id, content, parent_id, is_resolved)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [issueId, author_agent_id ?? null, content, parent_id ?? null, is_resolved],
    )

    // Trigger mentioned agents — scan for @agent-name patterns
    if (scheduler) {
      const mentions = content.match(/@([\w-]+)/g)
      if (mentions) {
        const uniqueNames = [...new Set(mentions.map((m) => m.slice(1)))]
        for (const agentName of uniqueNames) {
          const agentResult = await db.query<{ id: string }>(
            `SELECT id FROM agents WHERE company_id = $1 AND name = $2`,
            [companyId, agentName],
          )
          if (agentResult.rows.length > 0) {
            void scheduler.triggerNow(agentResult.rows[0].id, TriggerType.Mentioned)
          }
        }
      }
    }

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/issues/:issueId/comments — list comments ordered by created_at
  app.get('/:id/issues/:issueId/comments', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue belongs to company
    const existing = await db.query<Issue>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const { limit, offset } = parsePagination(c)
    const result = await db.query<IssueComment>(
      `SELECT * FROM issue_comments WHERE issue_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [issueId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  return app
}
