/**
 * Company CRUD routes — /api/companies
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Company } from '@shackleai/shared'
import { CreateCompanyInput, UpdateCompanyInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'
import { readConfig, writeConfig } from '../../config.js'

type Variables = CompanyScopeVariables

export function companiesRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies — list all companies
  app.get('/', async (c) => {
    const { limit, offset } = parsePagination(c)
    const result = await db.query<Company>(
      'SELECT * FROM companies ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies — create company
  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateCompanyInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { name, description, status, issue_prefix, budget_monthly_cents } = parsed.data

    const result = await db.query<Company>(
      `INSERT INTO companies (name, description, status, issue_prefix, budget_monthly_cents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description ?? null, status, issue_prefix, budget_monthly_cents],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id — get by id
  app.get('/:id', companyScope, async (c) => {
    const company = c.get('company')
    return c.json({ data: company })
  })

  // PATCH /api/companies/:id — update company
  app.patch('/:id', companyScope, async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateCompanyInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const company = c.get('company')
      return c.json({ data: company })
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
    const values = fields.map((f) => updates[f])

    const id = c.req.param('id')
    const result = await db.query<Company>(
      `UPDATE companies SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // GET /api/companies/:id/llm-keys — returns redacted LLM API keys
  app.get('/:id/llm-keys', async (c) => {
    const config = await readConfig()
    const keys = config?.llmKeys ?? {}
    return c.json({
      data: {
        openai: keys.openai ? '••••' + keys.openai.slice(-4) : null,
        anthropic: keys.anthropic ? '••••' + keys.anthropic.slice(-4) : null,
      },
    })
  })

  // PUT /api/companies/:id/llm-keys — save LLM API keys to config
  app.put('/:id/llm-keys', async (c) => {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const config = await readConfig()
    if (!config) {
      return c.json({ error: 'No config found' }, 500)
    }

    const llmKeys = config.llmKeys ?? {}
    if (body.openai !== undefined) llmKeys.openai = (body.openai as string) || undefined
    if (body.anthropic !== undefined) llmKeys.anthropic = (body.anthropic as string) || undefined

    await writeConfig({ ...config, llmKeys })

    // Also update process env so running agents pick up changes immediately
    if (llmKeys.openai) {
      process.env.OPENAI_API_KEY = llmKeys.openai
    } else {
      delete process.env.OPENAI_API_KEY
    }
    if (llmKeys.anthropic) {
      process.env.ANTHROPIC_API_KEY = llmKeys.anthropic
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }

    return c.json({
      data: {
        openai: llmKeys.openai ? '••••' + llmKeys.openai.slice(-4) : null,
        anthropic: llmKeys.anthropic ? '••••' + llmKeys.anthropic.slice(-4) : null,
      },
    })
  })

  return app
}
