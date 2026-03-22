/**
 * LLM Config CRUD routes — /api/companies/:id/llm-configs
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { LlmConfig } from '@shackleai/shared'
import { CreateLlmConfigInput, UpdateLlmConfigInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

/**
 * Coerce PGlite NUMERIC columns from strings to numbers.
 * PGlite serializes PostgreSQL NUMERIC type as strings (e.g. "0.70").
 * This mapper ensures the API always returns proper numbers.
 */
function coerceNumericFields(config: LlmConfig): LlmConfig {
  return {
    ...config,
    temperature:
      config.temperature != null ? parseFloat(String(config.temperature)) : null,
    max_tokens:
      config.max_tokens != null ? Number(config.max_tokens) : null,
  }
}

type Variables = CompanyScopeVariables

export function llmConfigsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/llm-configs — list configured models
  app.get('/:id/llm-configs', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<LlmConfig>(
      `SELECT * FROM llm_configs WHERE company_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return c.json({ data: result.rows.map(coerceNumericFields) })
  })

  // POST /api/companies/:id/llm-configs — add model config
  app.post('/:id/llm-configs', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateLlmConfigInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { provider, model, is_default, max_tokens, temperature } = parsed.data

    // If this config is being set as default, unset any existing default for this company
    if (is_default) {
      await db.query(
        `UPDATE llm_configs SET is_default = false, updated_at = NOW() WHERE company_id = $1 AND is_default = true`,
        [companyId],
      )
    }

    try {
      const result = await db.query<LlmConfig>(
        `INSERT INTO llm_configs
           (company_id, provider, model, is_default, max_tokens, temperature)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          companyId,
          provider,
          model,
          is_default,
          max_tokens ?? null,
          temperature ?? null,
        ],
      )

      return c.json({ data: coerceNumericFields(result.rows[0]) }, 201)
    } catch (err: unknown) {
      // Handle unique constraint violation (company_id, provider, model)
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('unique') || message.includes('duplicate')) {
        return c.json({ error: 'A config for this provider/model combination already exists' }, 409)
      }
      throw err
    }
  })

  // PUT /api/companies/:id/llm-configs/:configId — update model config
  app.put('/:id/llm-configs/:configId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const configId = c.req.param('configId')

    // Verify config exists and belongs to company
    const existing = await db.query<LlmConfig>(
      `SELECT id FROM llm_configs WHERE id = $1 AND company_id = $2`,
      [configId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'LLM config not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateLlmConfigInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<LlmConfig>(
        `SELECT * FROM llm_configs WHERE id = $1 AND company_id = $2`,
        [configId, companyId],
      )
      return c.json({ data: coerceNumericFields(result.rows[0]) })
    }

    // If setting as default, unset other defaults first
    if (updates.is_default === true) {
      await db.query(
        `UPDATE llm_configs SET is_default = false, updated_at = NOW() WHERE company_id = $1 AND is_default = true AND id != $2`,
        [companyId, configId],
      )
    }

    const setClauses = [...fields.map((f, i) => `${f} = $${i + 3}`), `updated_at = NOW()`].join(', ')
    const values = fields.map((f) => updates[f])

    try {
      const result = await db.query<LlmConfig>(
        `UPDATE llm_configs SET ${setClauses}
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [configId, companyId, ...values],
      )

      return c.json({ data: coerceNumericFields(result.rows[0]) })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('unique') || message.includes('duplicate')) {
        return c.json({ error: 'A config for this provider/model combination already exists' }, 409)
      }
      throw err
    }
  })

  // DELETE /api/companies/:id/llm-configs/:configId — remove model config
  app.delete('/:id/llm-configs/:configId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const configId = c.req.param('configId')

    // Check if any agents are using this config
    const agentsUsing = await db.query<{ id: string }>(
      `SELECT id FROM agents WHERE llm_config_id = $1 AND company_id = $2 LIMIT 1`,
      [configId, companyId],
    )
    if (agentsUsing.rows.length > 0) {
      return c.json(
        { error: 'Cannot delete LLM config that is assigned to agents. Remove agent assignments first.' },
        409,
      )
    }

    const result = await db.query<LlmConfig>(
      `DELETE FROM llm_configs WHERE id = $1 AND company_id = $2 RETURNING id`,
      [configId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'LLM config not found' }, 404)
    }

    return c.json({ data: { deleted: true, id: result.rows[0].id } })
  })

  return app
}
