/**
 * Hono app factory — creates and configures the ShackleAI API server
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { companiesRouter } from './routes/companies.js'
import { dashboardRouter } from './routes/dashboard.js'

const VERSION = '0.1.0'

export function createApp(db: DatabaseProvider): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: VERSION })
  })

  app.route('/api/companies', companiesRouter(db))
  app.route('/api/companies', dashboardRouter(db))

  return app
}
