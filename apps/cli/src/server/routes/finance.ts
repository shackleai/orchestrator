/**
 * Finance event routes — /api/companies/:id/finance
 *
 * Provides accounting-level spend tracking with breakdown and timeline views
 * for the finance dashboard.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type {
  FinanceEvent,
  FinanceBreakdown,
  FinanceTimelineEntry,
  FinanceTopSpender,
} from '@shackleai/shared'
import { CreateFinanceEventInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function financeRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/finance — list finance events with optional filters
  app.get('/:id/finance', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { from, to, event_type, agent_id } = c.req.query()

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(to)
    }

    if (event_type) {
      conditions.push(`event_type = $${paramIndex++}`)
      params.push(event_type)
    }

    if (agent_id) {
      conditions.push(`agent_id = $${paramIndex++}`)
      params.push(agent_id)
    }

    const { limit, offset } = parsePagination(c)

    const where = conditions.join(' AND ')
    const result = await db.query<FinanceEvent>(
      `SELECT * FROM finance_events WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/finance/breakdown — spend by agent, provider, or model
  app.get('/:id/finance/breakdown', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const groupBy = c.req.query('group_by') ?? 'agent_id'

    // Whitelist allowed group-by columns to prevent SQL injection
    const allowedColumns = ['agent_id', 'provider', 'model', 'event_type'] as const
    type AllowedColumn = (typeof allowedColumns)[number]

    if (!allowedColumns.includes(groupBy as AllowedColumn)) {
      return c.json({ error: `Invalid group_by — must be one of: ${allowedColumns.join(', ')}` }, 400)
    }

    const { from, to } = c.req.query()
    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(to)
    }

    const where = conditions.join(' AND ')

    const result = await db.query<FinanceBreakdown>(
      `SELECT
         COALESCE(${groupBy}::text, 'unknown') AS key,
         SUM(CASE WHEN event_type = 'charge' THEN amount_cents WHEN event_type IN ('refund','credit') THEN -amount_cents ELSE 0 END)::int AS total_cents,
         COUNT(*)::int AS event_count
       FROM finance_events
       WHERE ${where}
       GROUP BY ${groupBy}
       ORDER BY total_cents DESC`,
      params,
    )

    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/finance/timeline — daily spend over time
  app.get('/:id/finance/timeline', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { from, to } = c.req.query()

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(to)
    }

    const where = conditions.join(' AND ')

    const result = await db.query<FinanceTimelineEntry>(
      `SELECT
         created_at::date::text AS date,
         SUM(CASE WHEN event_type = 'charge' THEN amount_cents WHEN event_type IN ('refund','credit') THEN -amount_cents ELSE 0 END)::int AS total_cents,
         COUNT(*)::int AS event_count
       FROM finance_events
       WHERE ${where}
       GROUP BY created_at::date
       ORDER BY date ASC`,
      params,
    )

    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/finance/top-spenders — top N agents by spend
  app.get('/:id/finance/top-spenders', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { from, to } = c.req.query()
    const rawLimit = c.req.query('limit')
    const topN = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 10, 1), 100) : 10

    const conditions: string[] = ['fe.company_id = $1', 'fe.agent_id IS NOT NULL']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (from) {
      conditions.push(`fe.created_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`fe.created_at <= $${paramIndex++}`)
      params.push(to)
    }

    const where = conditions.join(' AND ')

    const result = await db.query<FinanceTopSpender>(
      `SELECT
         fe.agent_id,
         a.name AS agent_name,
         SUM(CASE WHEN fe.event_type = 'charge' THEN fe.amount_cents WHEN fe.event_type IN ('refund','credit') THEN -fe.amount_cents ELSE 0 END)::int AS total_cents,
         COUNT(*)::int AS event_count
       FROM finance_events fe
       JOIN agents a ON a.id = fe.agent_id
       WHERE ${where}
       GROUP BY fe.agent_id, a.name
       ORDER BY total_cents DESC
       LIMIT $${paramIndex}`,
      [...params, topN],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/finance — create finance event
  app.post('/:id/finance', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateFinanceEventInput.safeParse({
      company_id: companyId,
      ...(body as object),
    })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { event_type, amount_cents, description, agent_id, provider, model } =
      parsed.data

    const result = await db.query<FinanceEvent>(
      `INSERT INTO finance_events
         (company_id, event_type, amount_cents, description, agent_id, provider, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [companyId, event_type, amount_cents, description ?? null, agent_id ?? null, provider ?? null, model ?? null],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  return app
}
