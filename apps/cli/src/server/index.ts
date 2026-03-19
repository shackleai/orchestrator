/**
 * Hono app factory — creates and configures the ShackleAI API server
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import type { DatabaseProvider } from '@shackleai/db'
import type { Scheduler, StorageProvider } from '@shackleai/core'
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
import { toolCallsRouter } from './routes/tool-calls.js'
import { commentsRouter } from './routes/comments.js'
import { approvalsRouter } from './routes/approvals.js'
import { secretsRouter } from './routes/secrets.js'
import { quotasRouter } from './routes/quotas.js'
import { labelsRouter } from './routes/labels.js'
import { documentsRouter } from './routes/documents.js'
import { inboxRouter } from './routes/inbox.js'
import { templatesRouter, companyTemplatesRouter } from './routes/templates.js'
import { attachmentsRouter } from './routes/attachments.js'
import { assetsRouter, assetServeRouter } from './routes/assets.js'
import { companyLogoRouter } from './routes/company-logo.js'
import { workProductsRouter } from './routes/work-products.js'
import { workspaceOperationsRouter } from './routes/workspace-operations.js'
import { financeRouter } from './routes/finance.js'
import { llmConfigsRouter } from './routes/llm-configs.js'
import { pluginsRouter } from './routes/plugins.js'
import { createApiAuth } from './middleware/auth.js'

import { VERSION } from '../index.js'

export interface CreateAppOptions {
  scheduler?: Scheduler
  /** Pluggable file storage backend for attachments. */
  storage?: StorageProvider
  /** Skip API authentication — for testing only. NEVER set in production. */
  skipAuth?: boolean
}

export function createApp(db: DatabaseProvider, options?: CreateAppOptions): Hono {
  const app = new Hono()

  // --- CORS — allow dashboard cross-origin requests ---
  const corsOrigin = process.env.SHACKLEAI_CORS_ORIGIN
  app.use(
    '/api/*',
    cors({
      origin: corsOrigin
        ? corsOrigin.split(',').map((o) => o.trim())
        : (origin) => {
            // In development, allow any localhost origin (any port)
            if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
              return origin
            }
            return null
          },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['X-Total-Count'],
      maxAge: 86400,
    }),
  )

  // --- Health check — unauthenticated ---
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: VERSION })
  })

  // --- Global API authentication — protects all /api/* routes except /api/health ---
  if (!options?.skipAuth) {
    const apiAuthMiddleware = createApiAuth(db)
    app.use('/api/*', async (c, next) => {
      if (c.req.path === '/api/health') {
        return next()
      }
      return apiAuthMiddleware(c, next)
    })
  }

  app.route('/api/templates', templatesRouter())
  app.route('/api/companies', companiesRouter(db))
  app.route('/api/companies', companyTemplatesRouter(db))
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
  app.route('/api/companies', toolCallsRouter(db))
  app.route('/api/companies', commentsRouter(db, options?.scheduler))
  app.route('/api/companies', approvalsRouter(db))
  app.route('/api/companies', secretsRouter(db))
  app.route('/api/companies', quotasRouter(db))
  app.route('/api/companies', labelsRouter(db))
  app.route('/api/companies', inboxRouter(db))
  if (options?.storage) {
    app.route('/api/companies', attachmentsRouter(db, options.storage))
    app.route('/api/companies', assetsRouter(db, options.storage))
    app.route('/api/companies', companyLogoRouter(db, options.storage))
    app.route('/api/assets', assetServeRouter(db, options.storage))
  }
  app.route('/api/companies', workProductsRouter(db))
  app.route('/api/companies', documentsRouter(db))
  app.route('/api/companies', workspaceOperationsRouter(db))
  app.route('/api/companies', financeRouter(db))
  app.route('/api/companies', llmConfigsRouter(db))
  app.route('/api/companies', pluginsRouter(db))

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

    // Cache index.html once at startup — avoids readFileSync blocking the event loop per request
    const indexHtml = fs.readFileSync(path.join(dashboardDist, 'index.html'), 'utf-8')

    // SPA fallback — serve cached index.html for all non-API routes
    app.get('*', (c) => {
      return c.html(indexHtml)
    })
  }

  return app
}
