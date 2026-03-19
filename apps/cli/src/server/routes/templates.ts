/**
 * Template and company export/import routes — /api/templates and /api/companies/:id/import-template, /api/companies/:id/export-template
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { CompanyTemplateInput, CompanyExportInput } from '@shackleai/shared'
import type { CompanyExport } from '@shackleai/shared'
import {
  listTemplates,
  getTemplate,
  importTemplate,
  exportTemplate,
  exportCompany,
  importCompany,
} from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

/**
 * Top-level template routes — mounted at /api/templates
 * These don't require a company scope.
 */
export function templatesRouter(): Hono {
  const app = new Hono()

  // GET /api/templates — list all available built-in templates
  app.get('/', (c) => {
    const templates = listTemplates()
    return c.json({ data: templates })
  })

  // GET /api/templates/:slug — get a specific template by slug
  app.get('/:slug', (c) => {
    const slug = c.req.param('slug')
    const template = getTemplate(slug)

    if (!template) {
      return c.json({ error: `Template "${slug}" not found` }, 404)
    }

    return c.json({ data: template })
  })

  return app
}

/**
 * Company-scoped template routes — mounted at /api/companies
 * These require an existing company.
 */
export function companyTemplatesRouter(
  db: DatabaseProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // POST /api/companies/:id/import-template — import a template into a company
  app.post('/:id/import-template', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    // Accept either { slug: "software-team" } for built-in, or full template JSON
    const bodyObj = body as Record<string, unknown>

    let templateData: CompanyTemplateInput

    if (typeof bodyObj.slug === 'string') {
      // Load built-in template by slug
      const builtin = getTemplate(bodyObj.slug)
      if (!builtin) {
        return c.json({ error: `Template "${bodyObj.slug}" not found` }, 404)
      }
      templateData = builtin as CompanyTemplateInput
    } else {
      // Parse the body as a full template
      const parsed = CompanyTemplateInput.safeParse(body)
      if (!parsed.success) {
        return c.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          400,
        )
      }
      templateData = parsed.data
    }

    const result = await importTemplate(db, companyId as string, templateData)

    return c.json({ data: result }, 201)
  })

  // POST /api/companies/:id/export-template — export current company as template
  app.post('/:id/export-template', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const company = c.get('company')

    let name = company.name
    let description: string | undefined

    try {
      const body = (await c.req.json()) as Record<string, unknown>
      if (typeof body.name === 'string' && body.name.trim()) {
        name = body.name.trim()
      }
      if (typeof body.description === 'string') {
        description = body.description
      }
    } catch {
      // Body is optional — use company name as template name
    }

    const template = await exportTemplate(db, companyId as string, name, description)

    return c.json({ data: template })
  })


  // POST /api/companies/:id/export -- export full company state as JSON
  app.post("/:id/export", companyScope, async (c) => {
    const companyId = c.req.param("id")

    try {
      const data = await exportCompany(db, companyId as string)
      return c.json({ data })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed"
      return c.json({ error: message }, 500)
    }
  })


  // POST /api/companies/import -- import a full company export JSON
  app.post("/import", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = CompanyExportInput.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400,
      )
    }

    try {
      const result = await importCompany(db, parsed.data as CompanyExport)
      return c.json({ data: result }, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed"
      // Name collision returns 409 Conflict
      const status = message.includes("already exists") ? 409 : 500
      return c.json({ error: message }, status)
    }
  })

  return app
}
