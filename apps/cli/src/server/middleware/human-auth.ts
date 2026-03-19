/**
 * Human-only auth middleware — extracts user identity from JWT.
 *
 * Unlike the global createApiAuth (which accepts both JWT and API keys),
 * this middleware ONLY accepts JWT and attaches the user_id to context.
 * Use on endpoints that require a human operator (e.g., board claim).
 */

import { createHash } from 'node:crypto'
import type { Context, Next } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { UserSession } from '@shackleai/shared'
import { verifyJwt } from '../routes/auth.js'

export type HumanAuthVariables = {
  userId: string
  userEmail: string
  userRole: string
  db: DatabaseProvider
}

export async function humanAuth(
  c: Context<{ Variables: HumanAuthVariables }>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized — human JWT required' }, 401)
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return c.json({ error: 'Unauthorized — human JWT required' }, 401)
  }

  const payload = verifyJwt(token)
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Verify the session is still active
  const db: DatabaseProvider = c.get('db')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await db.query<UserSession>(
    'SELECT id FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash],
  )

  if (session.rows.length === 0) {
    return c.json({ error: 'Session expired or invalidated' }, 401)
  }

  c.set('userId', payload.sub)
  c.set('userEmail', payload.email)
  c.set('userRole', payload.role)

  return next()
}
