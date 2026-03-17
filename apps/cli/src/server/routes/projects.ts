/**
 * Project CRUD routes — /api/companies/:id/projects
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Project } from '@shackleai/shared'
import { CreateProjectInput, UpdateProjectInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function projectsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/projects — list projects (with optional goal_id filter)
  app.get('/:id/projects', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const goalId = c.req.query('goal_id')

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (goalId) {
      conditions.push(`goal_id = $${paramIndex++}`)
      params.push(goalId)
    }

    const where = conditions.join(' AND ')
    const result = await db.query<Project>(
      `SELECT * FROM projects WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/projects — create project
  app.post('/:id/projects', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateProjectInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { name, description, goal_id, lead_agent_id, status, target_date } = parsed.data

    const result = await db.query<Project>(
      `INSERT INTO projects
         (company_id, name, description, goal_id, lead_agent_id, status, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        name,
        description ?? null,
        goal_id ?? null,
        lead_agent_id ?? null,
        status,
        target_date ?? null,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/projects/:projectId — project detail
  app.get('/:id/projects/:projectId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const projectId = c.req.param('projectId')

    const result = await db.query<
      Project & {
        goal_title: string | null
        goal_level: string | null
        issues_count: number
      }
    >(
      `SELECT p.*,
              g.title AS goal_title, g.level AS goal_level,
              (SELECT COUNT(*)::int FROM issues i WHERE i.project_id = p.id) AS issues_count
       FROM projects p
       LEFT JOIN goals g ON g.id = p.goal_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [projectId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Project not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // PATCH /api/companies/:id/projects/:projectId — update project
  app.patch('/:id/projects/:projectId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const projectId = c.req.param('projectId')

    const existing = await db.query<Project>(
      `SELECT id FROM projects WHERE id = $1 AND company_id = $2`,
      [projectId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Project not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateProjectInput.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400,
      )
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as string[]

    if (fields.length === 0) {
      const result = await db.query<Project>(
        `SELECT * FROM projects WHERE id = $1 AND company_id = $2`,
        [projectId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => (updates as Record<string, unknown>)[f])

    const result = await db.query<Project>(
      `UPDATE projects SET ${setClauses}
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [projectId, companyId, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/projects/:projectId — delete (409 if linked issues)
  app.delete('/:id/projects/:projectId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const projectId = c.req.param('projectId')

    const existing = await db.query<Project>(
      `SELECT id FROM projects WHERE id = $1 AND company_id = $2`,
      [projectId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Project not found' }, 404)
    }

    const linkedIssues = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM issues WHERE project_id = $1`,
      [projectId],
    )
    if (linkedIssues.rows[0].count > 0) {
      return c.json(
        {
          error: 'Cannot delete project with linked issues',
          linked_issues: linkedIssues.rows[0].count,
        },
        409,
      )
    }

    await db.query(
      `DELETE FROM projects WHERE id = $1 AND company_id = $2`,
      [projectId, companyId],
    )

    return c.json({ data: { deleted: true } })
  })

  return app
}
