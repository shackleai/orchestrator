/**
 * Secrets CRUD routes — /api/companies/:id/secrets
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import { CreateSecretInput } from '@shackleai/shared'
import { SecretsManager } from '@shackleai/core'
import type { SecretListItem } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function secretsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()
  const secrets = new SecretsManager(db)

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/secrets — list secrets (names only, values redacted)
  app.get('/:id/secrets', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const items: SecretListItem[] = await secrets.list(companyId)
    return c.json({ data: items })
  })

  // POST /api/companies/:id/secrets — store a secret (encrypt before saving)
  app.post('/:id/secrets', companyScope, async (c) => {
    const companyId = c.req.param('id')!

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateSecretInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { name, value, created_by } = parsed.data
    const row = await secrets.store(companyId, name, value, created_by)

    if (!row) {
      return c.json({ error: 'Secret with this name already exists' }, 409)
    }

    return c.json({
      data: {
        id: row.id,
        name: row.name,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    }, 201)
  })

  // GET /api/companies/:id/secrets/:name — get decrypted value
  app.get('/:id/secrets/:name', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const name = c.req.param('name')!

    const value = await secrets.get(companyId, name)
    if (value === null) {
      return c.json({ error: 'Secret not found: ' + name }, 404)
    }

    return c.json({ data: { name, value } })
  })

  // DELETE /api/companies/:id/secrets/:name — delete a secret
  app.delete('/:id/secrets/:name', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const name = c.req.param('name')!

    const deleted = await secrets.delete(companyId, name)
    if (!deleted) {
      return c.json({ error: 'Secret not found: ' + name }, 404)
    }

    return c.json({ data: { deleted: true } })
  })

  return app
}
