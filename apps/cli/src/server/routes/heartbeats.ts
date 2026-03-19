/**
 * Heartbeat run routes — /api/companies/:id/heartbeats
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { HeartbeatRun, HeartbeatRunEvent } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function heartbeatsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/heartbeats — list heartbeat runs ordered by created_at DESC
  app.get('/:id/heartbeats', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<HeartbeatRun>(
      `SELECT * FROM heartbeat_runs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/agents/:agentId/heartbeats — heartbeats for a specific agent
  app.get('/:id/agents/:agentId/heartbeats', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<HeartbeatRun>(
      `SELECT * FROM heartbeat_runs WHERE company_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [companyId, agentId, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/heartbeats/:runId — detail of a single heartbeat run
  app.get('/:id/heartbeats/:runId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const runId = c.req.param('runId')

    const result = await db.query<HeartbeatRun>(
      `SELECT * FROM heartbeat_runs WHERE id = $1 AND company_id = $2`,
      [runId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Heartbeat run not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })


  // GET /api/companies/:id/heartbeats/:runId/events - granular events for a heartbeat run
  app.get('/:id/heartbeats/:runId/events', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const runId = c.req.param('runId')

    // Verify the heartbeat run exists and belongs to this company
    const runResult = await db.query<HeartbeatRun>(
      `SELECT id FROM heartbeat_runs WHERE id = $1 AND company_id = $2`,
      [runId, companyId],
    )

    if (runResult.rows.length === 0) {
      return c.json({ error: 'Heartbeat run not found' }, 404)
    }

    const result = await db.query<HeartbeatRunEvent>(
      `SELECT id, heartbeat_run_id, event_type, payload, created_at
       FROM heartbeat_run_events
       WHERE heartbeat_run_id = $1
       ORDER BY created_at ASC`,
      [runId],
    )

    return c.json({ data: result.rows })
  })

  return app
}
