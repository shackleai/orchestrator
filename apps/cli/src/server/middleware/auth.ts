/**
 * Bearer token auth middleware â€” validates agent API keys
 *
 * NOT applied globally. Use on agent-authenticated endpoints only.
 */

import { createHash } from 'node:crypto'
import type { Context, Next } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { AgentApiKey } from '@shackleai/shared'
import { AgentApiKeyStatus } from '@shackleai/shared'
import type { CompanyScopeVariables } from './company-scope.js'

export type AuthVariables = CompanyScopeVariables & {
  agentId: string
  authCompanyId: string
}

export async function agentAuth(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice('Bearer '.length).trim()

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const keyHash = createHash('sha256').update(token).digest('hex')

  const db: DatabaseProvider = c.get('db')

  const result = await db.query<AgentApiKey>(
    `SELECT * FROM agent_api_keys WHERE key_hash = $1 AND status = $2`,
    [keyHash, AgentApiKeyStatus.Active],
  )

  if (result.rows.length === 0) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const apiKey = result.rows[0]

  // Update last_used_at asynchronously â€” don't block the request
  db.query(
    `UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch(() => {
    // Non-fatal â€” best effort
  })

  c.set('agentId', apiKey.agent_id)
  c.set('authCompanyId', apiKey.company_id)

  return next()
}

/**
 * Factory that creates a global API auth middleware.
 * Closes over `db` so the root Hono app does not need typed Variables.
 */
export function createApiAuth(db: DatabaseProvider) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized — valid API key required' }, 401)
    }

    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return c.json({ error: 'Unauthorized — valid API key required' }, 401)
    }

    const keyHash = createHash('sha256').update(token).digest('hex')

    const result = await db.query<AgentApiKey>(
      `SELECT * FROM agent_api_keys WHERE key_hash = $1 AND status = $2`,
      [keyHash, AgentApiKeyStatus.Active],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Unauthorized — valid API key required' }, 401)
    }

    const apiKey = result.rows[0]

    // Update last_used_at asynchronously
    db.query(`UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1`, [
      apiKey.id,
    ]).catch(() => {})

    return next()
  }
}
