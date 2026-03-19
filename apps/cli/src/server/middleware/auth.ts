/**
 * Bearer token auth middleware — validates agent API keys OR human JWT tokens
 *
 * Supports two authentication modes:
 * 1. Agent API keys: SHA-256 hashed, looked up in agent_api_keys table
 * 2. Human JWT tokens: HMAC-SHA256 signed, session validated in user_sessions table
 *
 * NOT applied globally. Use on agent-authenticated endpoints only.
 */

import { createHash } from 'node:crypto'
import type { Context, Next } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { AgentApiKey, UserSession } from '@shackleai/shared'
import { AgentApiKeyStatus } from '@shackleai/shared'
import { verifyJwt } from '../routes/auth.js'
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

  // Update last_used_at asynchronously — don't block the request
  db.query(
    `UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch(() => {
    // Non-fatal — best effort
  })

  c.set('agentId', apiKey.agent_id)
  c.set('authCompanyId', apiKey.company_id)

  return next()
}

/**
 * Try to authenticate a Bearer token as a JWT (human user).
 * Returns true if the token is a valid, non-expired JWT with an active session.
 */
async function tryJwtAuth(db: DatabaseProvider, token: string): Promise<boolean> {
  const payload = verifyJwt(token)
  if (!payload) return false

  // Verify the session still exists and hasn't been invalidated (logout)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await db.query<UserSession>(
    'SELECT id FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash],
  )

  return session.rows.length > 0
}

/**
 * Try to authenticate a Bearer token as an agent API key.
 * Returns true if the token matches an active API key.
 */
async function tryApiKeyAuth(db: DatabaseProvider, token: string): Promise<boolean> {
  const keyHash = createHash('sha256').update(token).digest('hex')

  const result = await db.query<AgentApiKey>(
    `SELECT id FROM agent_api_keys WHERE key_hash = $1 AND status = $2`,
    [keyHash, AgentApiKeyStatus.Active],
  )

  if (result.rows.length === 0) return false

  // Update last_used_at asynchronously
  db.query(`UPDATE agent_api_keys SET last_used_at = NOW() WHERE id = $1`, [
    result.rows[0].id,
  ]).catch(() => {})

  return true
}

/**
 * Factory that creates a global API auth middleware.
 * Closes over `db` so the root Hono app does not need typed Variables.
 *
 * Accepts both:
 * - Agent API keys (for agent-to-server communication)
 * - Human JWT tokens (for dashboard/CLI user authentication)
 */
export function createApiAuth(db: DatabaseProvider) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized - valid API key or JWT required' }, 401)
    }

    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return c.json({ error: 'Unauthorized - valid API key or JWT required' }, 401)
    }

    // Try JWT first (human users), then fall back to API key (agents)
    const isJwt = await tryJwtAuth(db, token)
    if (isJwt) {
      return next()
    }

    const isApiKey = await tryApiKeyAuth(db, token)
    if (isApiKey) {
      return next()
    }

    return c.json({ error: 'Unauthorized - valid API key or JWT required' }, 401)
  }
}
