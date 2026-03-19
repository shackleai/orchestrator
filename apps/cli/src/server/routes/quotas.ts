/**
 * Quota window routes -- /api/companies/:id/quotas
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { QuotaWindow } from '@shackleai/shared'
import { CreateQuotaWindowInput } from '@shackleai/shared'
import { QuotaManager } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function quotasRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()
  const quotaManager = new QuotaManager(db)

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  app.get('/:id/quotas', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const result = await db.query<QuotaWindow>(
      `SELECT * FROM quota_windows WHERE company_id = $1 ORDER BY created_at ASC`,
      [companyId],
    )
    return c.json({ data: result.rows })
  })

  app.post('/:id/quotas', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateQuotaWindowInput.safeParse({
      company_id: companyId,
      ...(body as object),
    })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { agent_id, provider, window_duration, max_requests, max_tokens } = parsed.data

    if (max_requests == null && max_tokens == null) {
      return c.json({ error: 'At least one of max_requests or max_tokens must be set' }, 400)
    }

    const result = await db.query<QuotaWindow>(
      `INSERT INTO quota_windows (company_id, agent_id, provider, window_duration, max_requests, max_tokens)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [companyId, agent_id ?? null, provider ?? null, window_duration, max_requests ?? null, max_tokens ?? null],
    )
    return c.json({ data: result.rows[0] }, 201)
  })

  app.delete('/:id/quotas/:quotaId', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const quotaId = c.req.param('quotaId')
    const result = await db.query(
      `DELETE FROM quota_windows WHERE id = $1 AND company_id = $2 RETURNING id`,
      [quotaId, companyId],
    )
    if (result.rows.length === 0) {
      return c.json({ error: 'Quota window not found' }, 404)
    }
    return c.json({ data: { deleted: true } })
  })

  app.get('/:id/agents/:agentId/quota-status', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const agentId = c.req.param('agentId')!
    const statuses = await quotaManager.getQuotaStatus(companyId, agentId)
    return c.json({ data: statuses })
  })

  return app
}
