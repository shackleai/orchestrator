/**
 * Dashboard metrics routes — /api/companies/:id/dashboard
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { IssueStatus } from '@shackleai/shared'
import type { ActivityLogEntry } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

interface DashboardMetrics {
  agentCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  totalSpendCents: number
  recentActivity: ActivityLogEntry[]
}

export function dashboardRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/dashboard
  app.get('/:id/dashboard', companyScope, async (c) => {
    const id = c.req.param('id')

    const [agentRes, taskRes, openRes, completedRes, spendRes, activityRes] =
      await Promise.all([
        db.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM agents WHERE company_id = $1',
          [id],
        ),
        db.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM issues WHERE company_id = $1',
          [id],
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM issues
           WHERE company_id = $1
             AND status NOT IN ($2, $3)`,
          [id, IssueStatus.Done, IssueStatus.Cancelled],
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM issues
           WHERE company_id = $1 AND status = $2`,
          [id, IssueStatus.Done],
        ),
        db.query<{ total: string }>(
          'SELECT COALESCE(SUM(cost_cents), 0) AS total FROM cost_events WHERE company_id = $1',
          [id],
        ),
        db.query<ActivityLogEntry>(
          `SELECT * FROM activity_log
           WHERE company_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [id],
        ),
      ])

    const metrics: DashboardMetrics = {
      agentCount: parseInt(agentRes.rows[0]?.count ?? '0', 10),
      taskCount: parseInt(taskRes.rows[0]?.count ?? '0', 10),
      openTasks: parseInt(openRes.rows[0]?.count ?? '0', 10),
      completedTasks: parseInt(completedRes.rows[0]?.count ?? '0', 10),
      totalSpendCents: parseInt(spendRes.rows[0]?.total ?? '0', 10),
      recentActivity: activityRes.rows,
    }

    return c.json({ data: metrics })
  })

  return app
}
