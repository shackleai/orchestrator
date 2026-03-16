/**
 * Hono app factory — creates and configures the ShackleAI API server
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { companiesRouter } from './routes/companies.js'
import { dashboardRouter } from './routes/dashboard.js'
import { agentsRouter } from './routes/agents.js'
import { issuesRouter } from './routes/issues.js'

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

  return app
}
