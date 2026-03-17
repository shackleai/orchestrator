/**
 * Hono app factory — creates and configures the ShackleAI API server
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import type { DatabaseProvider } from '@shackleai/db'
import type { Scheduler } from '@shackleai/core'
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
import { worktreesRouter } from './routes/worktrees.js'

import { VERSION } from '../index.js'

export interface CreateAppOptions {
  scheduler?: Scheduler
}

export function createApp(db: DatabaseProvider, options?: CreateAppOptions): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: VERSION })
  })

  app.route('/api/companies', companiesRouter(db))
  app.route('/api/companies', dashboardRouter(db))
  app.route('/api/companies', agentsRouter(db, options?.scheduler))
  app.route('/api/companies', issuesRouter(db, options?.scheduler))
  app.route('/api/companies', policiesRouter(db))
  app.route('/api/companies', costsRouter(db))
  app.route('/api/companies', heartbeatsRouter(db))
  app.route('/api/companies', activityRouter(db))
  app.route('/api/companies', goalsRouter(db))
  app.route('/api/companies', projectsRouter(db))
  app.route('/api/companies', worktreesRouter(db))

  // --- Serve dashboard static files ---
  // Resolve dashboard dist relative to this file (works in monorepo and npm install)
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  // From dist/server/ → ../../ = apps/cli/ → ../dashboard/dist = apps/dashboard/dist
  const dashboardDist = path.resolve(__dirname, '..', '..', '..', 'dashboard', 'dist')

  if (fs.existsSync(dashboardDist)) {
    // Serve static assets (JS, CSS, images)
    app.use(
      '/assets/*',
      serveStatic({ root: dashboardDist, rewriteRequestPath: (p) => p }),
    )

    // Serve favicon
    app.use(
      '/favicon.svg',
      serveStatic({ root: dashboardDist, rewriteRequestPath: () => '/favicon.svg' }),
    )

    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (c) => {
      const html = fs.readFileSync(path.join(dashboardDist, 'index.html'), 'utf-8')
      return c.html(html)
    })
  }

  return app
}
