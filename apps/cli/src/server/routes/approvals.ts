/**
 * Approval workflow routes — /api/companies/:id/approvals
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Approval, Agent } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function approvalsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/approvals — list approvals (optional ?status=pending filter)
  app.get('/:id/approvals', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const status = c.req.query('status')

    let result
    if (status) {
      result = await db.query<Approval>(
        `SELECT * FROM approvals WHERE company_id = $1 AND status = $2 ORDER BY created_at DESC`,
        [companyId, status],
      )
    } else {
      result = await db.query<Approval>(
        `SELECT * FROM approvals WHERE company_id = $1 ORDER BY created_at DESC`,
        [companyId],
      )
    }

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/approvals — create approval
  app.post('/:id/approvals', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: { type?: string; payload?: Record<string, unknown>; requested_by?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (!body.type || !body.payload) {
      return c.json({ error: 'type and payload are required' }, 400)
    }

    const result = await db.query<Approval>(
      `INSERT INTO approvals (company_id, type, payload, requested_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [companyId, body.type, JSON.stringify(body.payload), body.requested_by ?? null],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // POST /api/companies/:id/approvals/:aid/approve — approve and optionally execute
  app.post('/:id/approvals/:aid/approve', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const approvalId = c.req.param('aid')

    let decidedBy: string | null = null
    try {
      const body = await c.req.json()
      if (body && typeof body === 'object' && 'decided_by' in body) {
        decidedBy = String(body.decided_by)
      }
    } catch {
      // body is optional
    }

    // Fetch the approval
    const existing = await db.query<Approval>(
      `SELECT * FROM approvals WHERE id = $1 AND company_id = $2`,
      [approvalId, companyId],
    )

    if (existing.rows.length === 0) {
      return c.json({ error: 'Approval not found' }, 404)
    }

    if (existing.rows[0].status !== 'pending') {
      return c.json({ error: 'Approval already decided' }, 409)
    }

    // Mark as approved
    const updated = await db.query<Approval>(
      `UPDATE approvals SET status = 'approved', decided_by = $1, decided_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [decidedBy, approvalId, companyId],
    )

    // Execute payload if type is agent_create
    const approval = updated.rows[0]
    let createdAgent: Agent | null = null

    if (approval.type === 'agent_create') {
      const payload = typeof approval.payload === 'string'
        ? JSON.parse(approval.payload as string)
        : approval.payload

      const agentResult = await db.query<Agent>(
        `INSERT INTO agents (company_id, name, role, adapter_type, adapter_config)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          companyId,
          payload.name ?? 'Unnamed Agent',
          payload.role ?? 'general',
          payload.adapter_type ?? 'process',
          JSON.stringify(payload.adapter_config ?? {}),
        ],
      )
      createdAgent = agentResult.rows[0]
    }

    return c.json({
      data: {
        approval: updated.rows[0],
        ...(createdAgent ? { agent: createdAgent } : {}),
      },
    })
  })

  // POST /api/companies/:id/approvals/:aid/reject — reject
  app.post('/:id/approvals/:aid/reject', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const approvalId = c.req.param('aid')

    let decidedBy: string | null = null
    try {
      const body = await c.req.json()
      if (body && typeof body === 'object' && 'decided_by' in body) {
        decidedBy = String(body.decided_by)
      }
    } catch {
      // body is optional
    }

    // Verify exists
    const existing = await db.query<Approval>(
      `SELECT * FROM approvals WHERE id = $1 AND company_id = $2`,
      [approvalId, companyId],
    )

    if (existing.rows.length === 0) {
      return c.json({ error: 'Approval not found' }, 404)
    }

    if (existing.rows[0].status !== 'pending') {
      return c.json({ error: 'Approval already decided' }, 409)
    }

    const updated = await db.query<Approval>(
      `UPDATE approvals SET status = 'rejected', decided_by = $1, decided_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [decidedBy, approvalId, companyId],
    )

    return c.json({ data: updated.rows[0] })
  })

  return app
}
