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
  // Supports: entity_type, from (date), to (date)
  app.get('/:id/activity', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { entity_type, from, to } = c.req.query()

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

    const where = conditions.join(' AND ')
    const result = await db.query<ActivityLogEntry>(
      `SELECT * FROM activity_log WHERE ${where} ORDER BY created_at DESC`,
      params,
    )

    return c.json({ data: result.rows })
  })

  return app
}
