/**
 * Auth routes — /api/auth
 *
 * Human user authentication using JWT (HMAC-SHA256) and scrypt password hashing.
 * No external auth libraries — uses Node.js built-in crypto module.
 */

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { User, UserPublic, UserSession, AuthResponse } from '@shackleai/shared'
import { RegisterUserInput, LoginUserInput } from '@shackleai/shared'
import { readConfig } from '../../config.js'

const scryptAsync = promisify(scrypt)

/** Session TTL: 7 days in milliseconds. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * JWT secret — read from env or generate a random one per process.
 * In production, SHACKLEAI_JWT_SECRET should always be set.
 */
function getJwtSecret(): string {
  return process.env.SHACKLEAI_JWT_SECRET ?? 'shackleai-dev-jwt-secret-change-me'
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt — Node.js built-in, no external deps)
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':')
  if (!salt || !key) return false
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  const keyBuffer = Buffer.from(key, 'hex')
  if (derived.length !== keyBuffer.length) return false
  return timingSafeEqual(derived, keyBuffer)
}

// ---------------------------------------------------------------------------
// JWT (HMAC-SHA256 — no external deps)
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub: string // user id
  email: string
  role: string
  jti: string // unique token id to prevent same-second collisions
  iat: number
  exp: number
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function signJwt(payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>, ttlMs: number): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const fullPayload: JwtPayload = {
    ...payload,
    jti: randomBytes(16).toString('hex'),
    iat: now,
    exp: now + Math.floor(ttlMs / 1000),
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload))
  const signature = createHmac('sha256', getJwtSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  return `${headerB64}.${payloadB64}.${signature}`
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerB64, payloadB64, signature] = parts

  // Verify signature
  const expected = createHmac('sha256', getJwtSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  if (signature !== expected) return null

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null

    return payload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPublicUser(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    company_id: user.company_id,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function authRouter(db: DatabaseProvider): Hono {
  const app = new Hono()

  // POST /api/auth/register
  app.post('/register', async (c) => {
    // Registration lockdown: env var takes precedence over config file
    const envFlag = process.env.SHACKLEAI_REGISTRATION_ENABLED
    if (envFlag !== undefined) {
      if (envFlag === 'false' || envFlag === '0') {
        return c.json({ error: 'Registration is currently disabled' }, 403)
      }
    } else {
      // Fall back to config file
      const config = await readConfig()
      if (
        config &&
        (config as unknown as Record<string, unknown>).registration_enabled === false
      ) {
        return c.json({ error: 'Registration is currently disabled' }, 403)
      }
    }

    const body = await c.req.json()
    const parsed = RegisterUserInput.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    const { email, password, name, role } = parsed.data

    // Check if email already exists
    const existing = await db.query<User>(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()],
    )

    if (existing.rows.length > 0) {
      return c.json({ error: 'A user with this email already exists' }, 409)
    }

    const passwordHash = await hashPassword(password)

    const result = await db.query<User>(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email.toLowerCase(), passwordHash, name, role],
    )

    const user = result.rows[0]

    // Create JWT
    const token = signJwt({ sub: user.id, email: user.email, role: user.role }, SESSION_TTL_MS)

    // Store session (hash the token for lookup on logout).
    // ON CONFLICT DO NOTHING handles the rare case where the same token is
    // issued twice within the same second (same iat/exp/sub payload).
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [user.id, tokenHash, expiresAt],
    )

    const response: AuthResponse = { user: toPublicUser(user), token }
    return c.json({ data: response }, 201)
  })

  // POST /api/auth/login
  app.post('/login', async (c) => {
    const body = await c.req.json()
    const parsed = LoginUserInput.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    const { email, password } = parsed.data

    const result = await db.query<User>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    const user = result.rows[0]
    const valid = await verifyPassword(password, user.password_hash)

    if (!valid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    // Create JWT
    const token = signJwt({ sub: user.id, email: user.email, role: user.role }, SESSION_TTL_MS)

    // Store session. ON CONFLICT handles duplicate token hash (same second).
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [user.id, tokenHash, expiresAt],
    )

    const response: AuthResponse = { user: toPublicUser(user), token }
    return c.json({ data: response })
  })

  // POST /api/auth/logout
  app.post('/logout', async (c) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice('Bearer '.length).trim()
    const tokenHash = createHash('sha256').update(token).digest('hex')

    await db.query(
      'DELETE FROM user_sessions WHERE token_hash = $1',
      [tokenHash],
    )

    return c.json({ data: { message: 'Logged out' } })
  })

  // GET /api/auth/me
  app.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice('Bearer '.length).trim()
    const payload = verifyJwt(token)

    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Verify session still exists (not logged out)
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const session = await db.query<UserSession>(
      'SELECT * FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash],
    )

    if (session.rows.length === 0) {
      return c.json({ error: 'Session expired or invalidated' }, 401)
    }

    const result = await db.query<User>(
      'SELECT * FROM users WHERE id = $1',
      [payload.sub],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ data: toPublicUser(result.rows[0]) })
  })

  return app
}
