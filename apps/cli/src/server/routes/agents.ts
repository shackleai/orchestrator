/**
 * Agent CRUD + lifecycle routes — /api/companies/:id/agents
 */

import { Hono } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import type { Agent, AgentApiKey } from '@shackleai/shared'
import { CreateAgentInput, UpdateAgentInput } from '@shackleai/shared'
import { AgentStatus, AgentApiKeyStatus } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function agentsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/agents — list agents with status, budget, last_heartbeat_at
  app.get('/:id/agents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<Agent>(
      `SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/agents — create agent
  app.post('/:id/agents', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    // Inject company_id from the URL param so callers don't have to repeat it
    const parsed = CreateAgentInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const {
      name,
      title,
      role,
      status,
      reports_to,
      capabilities,
      adapter_type,
      adapter_config,
      budget_monthly_cents,
    } = parsed.data

    const result = await db.query<Agent>(
      `INSERT INTO agents
         (company_id, name, title, role, status, reports_to, capabilities,
          adapter_type, adapter_config, budget_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        companyId,
        name,
        title ?? null,
        role,
        status,
        reports_to ?? null,
        capabilities ?? null,
        adapter_type,
        JSON.stringify(adapter_config),
        budget_monthly_cents,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/agents/:agentId — agent detail
  app.get('/:id/agents/:agentId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // PATCH /api/companies/:id/agents/:agentId — update agent
  app.patch('/:id/agents/:agentId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    // Verify agent exists and belongs to company
    const existing = await db.query<Agent>(
      `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateAgentInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<Agent>(
        `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
        [agentId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    const setClauses = fields
      .map((f, i) => {
        if (f === 'adapter_config') return `${f} = $${i + 3}`
        return `${f} = $${i + 3}`
      })
      .join(', ')

    const values = fields.map((f) => {
      const val = updates[f]
      if (f === 'adapter_config' && val !== undefined) return JSON.stringify(val)
      return val
    })

    const result = await db.query<Agent>(
      `UPDATE agents SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [agentId, companyId, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/pause — set status='paused'
  app.post('/:id/agents/:agentId/pause', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Paused, agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/resume — set status='idle'
  app.post('/:id/agents/:agentId/resume', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Idle, agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/terminate — set status='terminated'
  app.post('/:id/agents/:agentId/terminate', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Terminated, agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/wakeup — on-demand heartbeat
  app.post('/:id/agents/:agentId/wakeup', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `UPDATE agents SET last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: { agent: result.rows[0], triggered: true } })
  })

  // POST /api/companies/:id/agents/:agentId/api-keys — generate API key
  app.post('/:id/agents/:agentId/api-keys', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    // Verify agent belongs to company
    const agentResult = await db.query<Agent>(
      `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (agentResult.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // Parse optional label from body
    let label: string | null = null
    try {
      const body = await c.req.json()
      if (body && typeof body === 'object' && 'label' in body && typeof body.label === 'string') {
        label = body.label
      }
    } catch {
      // body is optional — no label
    }

    const plainKey = randomBytes(32).toString('hex')
    const keyHash = createHash('sha256').update(plainKey).digest('hex')

    const result = await db.query<AgentApiKey>(
      `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, label, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, agent_id, company_id, label, status, last_used_at, created_at`,
      [agentId, companyId, keyHash, label, AgentApiKeyStatus.Active],
    )

    return c.json(
      {
        data: {
          ...result.rows[0],
          // Returned ONCE — never stored in plaintext
          key: plainKey,
        },
      },
      201,
    )
  })

  return app
}
