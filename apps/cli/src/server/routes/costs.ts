/**
 * Cost event routes — /api/companies/:id/costs
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { CostEvent } from '@shackleai/shared'
import { CreateCostEventInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

type CostByAgent = {
  agent_id: string | null
  total_cost_cents: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
}

export function costsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/costs — list cost events with optional date range
  app.get('/:id/costs', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { from, to } = c.req.query()

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (from) {
      conditions.push(`occurred_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`occurred_at <= $${paramIndex++}`)
      params.push(to)
    }

    const where = conditions.join(' AND ')
    const result = await db.query<CostEvent>(
      `SELECT * FROM cost_events WHERE ${where} ORDER BY occurred_at DESC`,
      params,
    )

    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/costs/by-agent — aggregate costs grouped by agent_id
  app.get('/:id/costs/by-agent', companyScope, async (c) => {
    const companyId = c.req.param('id')

    const result = await db.query<CostByAgent>(
      `SELECT
         agent_id,
         SUM(cost_cents)::int AS total_cost_cents,
         SUM(input_tokens)::int AS total_input_tokens,
         SUM(output_tokens)::int AS total_output_tokens,
         COUNT(*)::int AS event_count
       FROM cost_events
       WHERE company_id = $1
       GROUP BY agent_id
       ORDER BY total_cost_cents DESC`,
      [companyId],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/costs/events — create cost event
  app.post('/:id/costs/events', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateCostEventInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { agent_id, issue_id, provider, model, input_tokens, output_tokens, cost_cents } =
      parsed.data

    const result = await db.query<CostEvent>(
      `INSERT INTO cost_events
         (company_id, agent_id, issue_id, provider, model, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        companyId,
        agent_id ?? null,
        issue_id ?? null,
        provider ?? null,
        model ?? null,
        input_tokens,
        output_tokens,
        cost_cents,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  return app
}
