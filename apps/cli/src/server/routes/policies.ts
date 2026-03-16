/**
 * Policy CRUD routes — /api/companies/:id/policies
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Policy } from '@shackleai/shared'
import { CreatePolicyInput, UpdatePolicyInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function policiesRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/policies — list policies for company
  app.get('/:id/policies', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<Policy>(
      `SELECT * FROM policies WHERE company_id = $1 ORDER BY priority DESC, created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/policies — create policy
  app.post('/:id/policies', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreatePolicyInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { agent_id, name, tool_pattern, action, priority, max_calls_per_hour } = parsed.data

    const result = await db.query<Policy>(
      `INSERT INTO policies
         (company_id, agent_id, name, tool_pattern, action, priority, max_calls_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        agent_id ?? null,
        name,
        tool_pattern,
        action,
        priority,
        max_calls_per_hour ?? null,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // PATCH /api/companies/:id/policies/:policyId — update policy
  app.patch('/:id/policies/:policyId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const policyId = c.req.param('policyId')

    // Verify policy exists and belongs to company
    const existing = await db.query<Policy>(
      `SELECT id FROM policies WHERE id = $1 AND company_id = $2`,
      [policyId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Policy not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdatePolicyInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<Policy>(
        `SELECT * FROM policies WHERE id = $1 AND company_id = $2`,
        [policyId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => updates[f])

    const result = await db.query<Policy>(
      `UPDATE policies SET ${setClauses}
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [policyId, companyId, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/policies/:policyId — delete policy
  app.delete('/:id/policies/:policyId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const policyId = c.req.param('policyId')

    const result = await db.query<Policy>(
      `DELETE FROM policies WHERE id = $1 AND company_id = $2 RETURNING id`,
      [policyId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Policy not found' }, 404)
    }

    return c.json({ data: { deleted: true, id: result.rows[0].id } })
  })

  return app
}
