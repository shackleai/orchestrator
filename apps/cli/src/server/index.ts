/**
 * Hono app factory — creates and configures the ShackleAI API server
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { companiesRouter } from './routes/companies.js'
import { dashboardRouter } from './routes/dashboard.js'
import { agentsRouter } from './routes/agents.js'
import { issuesRouter } from './routes/issues.js'
import { policiesRouter } from './routes/policies.js'
import { costsRouter } from './routes/costs.js'
import { heartbeatsRouter } from './routes/heartbeats.js'
import { activityRouter } from './routes/activity.js'
import { goalsRouter } from './routes/goals.js'
import { projectsRouter } from './routes/projects.js'

const VERSION = '0.1.0'

export function createApp(db: DatabaseProvider): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: VERSION })
  })

  app.route('/api/companies', companiesRouter(db))
  app.route('/api/companies', dashboardRouter(db))
  app.route('/api/companies', agentsRouter(db))
  app.route('/api/companies', issuesRouter(db))
  app.route('/api/companies', policiesRouter(db))
  app.route('/api/companies', costsRouter(db))
  app.route('/api/companies', heartbeatsRouter(db))
  app.route('/api/companies', activityRouter(db))
  app.route('/api/companies', goalsRouter(db))
  app.route('/api/companies', projectsRouter(db))

  return app
}
