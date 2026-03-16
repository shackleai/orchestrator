/**
 * Activity log routes — /api/companies/:id/activity
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { ActivityLogEntry } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function activityRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/activity — audit log with query filters
  // Supports: entity_type, from (date), to (date), since (ISO timestamp), agentId, limit
  app.get('/:id/activity', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { entity_type, from, to, since, agentId, limit: limitStr } = c.req.query()

    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIndex = 2

    if (entity_type) {
      conditions.push(`entity_type = $${paramIndex++}`)
      params.push(entity_type)
    }

    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(from)
    }

    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(to)
    }

    // Agent communication polling params
    if (since) {
      conditions.push(`created_at > $${paramIndex++}`)
      params.push(since)
    }

    if (agentId) {
      conditions.push(`actor_id = $${paramIndex++}`)
      params.push(agentId)
    }

    // Cap limit to 50 (default 50)
    const MAX_LIMIT = 50
    let limit = MAX_LIMIT
    if (limitStr) {
      const parsed = parseInt(limitStr, 10)
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, MAX_LIMIT)
      }
    }

    const where = conditions.join(' AND ')
    const result = await db.query<ActivityLogEntry>(
      `SELECT * FROM activity_log WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex}`,
      [...params, limit],
    )

    return c.json({ data: result.rows })
  })

  return app
}
