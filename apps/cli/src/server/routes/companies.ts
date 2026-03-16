/**
 * Company CRUD routes — /api/companies
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Company } from '@shackleai/shared'
import { CreateCompanyInput, UpdateCompanyInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

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
    const result = await db.query<Company>('SELECT * FROM companies ORDER BY created_at DESC')
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

  return app
}
