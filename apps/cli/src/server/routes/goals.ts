/**
 * Goal CRUD routes — /api/companies/:id/goals
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Goal } from '@shackleai/shared'
import { CreateGoalInput, UpdateGoalInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function goalsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/goals — list goals (with optional project_id filter)
  app.get('/:id/goals', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const projectId = c.req.query('project_id')

    const conditions: string[] = ['g.company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (projectId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM projects p WHERE p.goal_id = g.id AND p.id = $${paramIndex++})`,
      )
      params.push(projectId)
    }

    const where = conditions.join(' AND ')
    const result = await db.query<Goal>(
      `SELECT g.* FROM goals g WHERE ${where} ORDER BY g.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/goals — create goal
  app.post('/:id/goals', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateGoalInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { title, description, parent_id, level, status, owner_agent_id } = parsed.data

    const result = await db.query<Goal>(
      `INSERT INTO goals
         (company_id, title, description, parent_id, level, status, owner_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        title,
        description ?? null,
        parent_id ?? null,
        level,
        status,
        owner_agent_id ?? null,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/goals/:goalId — goal detail with linked counts
  app.get('/:id/goals/:goalId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const goalId = c.req.param('goalId')

    const result = await db.query<
      Goal & { issues_count: number; projects_count: number }
    >(
      `SELECT g.*,
              (SELECT COUNT(*)::int FROM issues i WHERE i.goal_id = g.id) AS issues_count,
              (SELECT COUNT(*)::int FROM projects p WHERE p.goal_id = g.id) AS projects_count
       FROM goals g
       WHERE g.id = $1 AND g.company_id = $2`,
      [goalId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Goal not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // PATCH /api/companies/:id/goals/:goalId — update goal
  app.patch('/:id/goals/:goalId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const goalId = c.req.param('goalId')

    const existing = await db.query<Goal>(
      `SELECT id FROM goals WHERE id = $1 AND company_id = $2`,
      [goalId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Goal not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateGoalInput.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400,
      )
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as string[]

    if (fields.length === 0) {
      const result = await db.query<Goal>(
        `SELECT * FROM goals WHERE id = $1 AND company_id = $2`,
        [goalId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => (updates as Record<string, unknown>)[f])

    const result = await db.query<Goal>(
      `UPDATE goals SET ${setClauses}
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [goalId, companyId, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/goals/:goalId — delete (409 if linked)
  app.delete('/:id/goals/:goalId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const goalId = c.req.param('goalId')

    const existing = await db.query<Goal>(
      `SELECT id FROM goals WHERE id = $1 AND company_id = $2`,
      [goalId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Goal not found' }, 404)
    }

    const linkedIssues = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM issues WHERE goal_id = $1`,
      [goalId],
    )
    if (linkedIssues.rows[0].count > 0) {
      return c.json(
        {
          error: 'Cannot delete goal with linked issues',
          linked_issues: linkedIssues.rows[0].count,
        },
        409,
      )
    }

    const linkedProjects = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM projects WHERE goal_id = $1`,
      [goalId],
    )
    if (linkedProjects.rows[0].count > 0) {
      return c.json(
        {
          error: 'Cannot delete goal with linked projects',
          linked_projects: linkedProjects.rows[0].count,
        },
        409,
      )
    }

    const childGoals = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM goals WHERE parent_id = $1`,
      [goalId],
    )
    if (childGoals.rows[0].count > 0) {
      return c.json(
        {
          error: 'Cannot delete goal with child goals',
          child_goals: childGoals.rows[0].count,
        },
        409,
      )
    }

    await db.query(`DELETE FROM goals WHERE id = $1 AND company_id = $2`, [
      goalId,
      companyId,
    ])

    return c.json({ data: { deleted: true } })
  })

  return app
}
