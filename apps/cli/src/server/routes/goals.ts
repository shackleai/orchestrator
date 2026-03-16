/**
 * Goal CRUD routes — /api/companies/:id/goals
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Goal } from '@shackleai/shared'
import { CreateGoalInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function goalsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/goals — list goals
  app.get('/:id/goals', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const result = await db.query<Goal>(
      `SELECT * FROM goals WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId],
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

  return app
}
