/**
 * Plugin CRUD routes — /api/companies/:id/plugins
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { PluginManager, AdapterRegistry } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function pluginsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()
  const adapterRegistry = new AdapterRegistry()
  const pluginManager = new PluginManager(db, adapterRegistry)

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/plugins — list installed plugins
  app.get('/:id/plugins', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const plugins = await pluginManager.list(companyId)
    return c.json({ data: plugins })
  })

  // GET /api/companies/:id/plugins/:name — get a specific plugin
  app.get('/:id/plugins/:name', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const name = c.req.param('name')!

    const plugin = await pluginManager.getPlugin(companyId, name)
    if (!plugin) {
      return c.json({ error: 'Plugin not found: ' + name }, 404)
    }

    return c.json({ data: plugin })
  })

  // POST /api/companies/:id/plugins — install a plugin
  app.post('/:id/plugins', companyScope, async (c) => {
    const companyId = c.req.param('id')!

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Request body must be an object' }, 400)
    }

    const { source, config } = body as { source?: string; config?: Record<string, unknown> }

    if (typeof source !== 'string' || source.length === 0) {
      return c.json({ error: 'Missing required field: source (npm package name or path)' }, 400)
    }

    try {
      const info = await pluginManager.install(companyId, source, config ?? {})
      return c.json({ data: info }, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 400)
    }
  })

  // DELETE /api/companies/:id/plugins/:name — uninstall a plugin
  app.delete('/:id/plugins/:name', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const name = c.req.param('name')!

    const deleted = await pluginManager.uninstall(companyId, name)
    if (!deleted) {
      return c.json({ error: 'Plugin not found: ' + name }, 404)
    }

    return c.json({ data: { deleted: true } })
  })

  return app
}
