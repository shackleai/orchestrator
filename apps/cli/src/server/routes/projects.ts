/**
 * Project CRUD routes — /api/companies/:id/projects
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Project } from '@shackleai/shared'
import { CreateProjectInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function projectsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/projects — list projects
  app.get('/:id/projects', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const result = await db.query<Project>(
      `SELECT * FROM projects WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId],
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

  return app
}
