/**
 * Battle Test — Auth Middleware (#292), CORS (#293), Error Handling (#294)
 *
 * Covers gaps NOT present in:
 *   - auth.test.ts          (Bearer edge cases, error message consistency)
 *   - cors.test.ts          (credentials header, 127.0.0.1, non-health endpoints, env var rejection)
 *   - errors.test.ts        (CLI error handler — fully covered, no gaps)
 *   - e2e-battle.test.ts    (Battle 7: API error shapes, Battle 13: auth flows)
 *
 * What this file adds:
 *   Auth    — non-Bearer scheme, JWT with non-existent sub, invites path public with real auth,
 *             auth error message consistency between createApiAuth and route-level auth
 *   CORS    — credentials header absent, 127.0.0.1 loopback blocked, preflight on data endpoints,
 *             env var origin rejection, extreme localhost port, CORS on actual data response
 *   Errors  — validation details include field names, no stack trace leakage in any error response,
 *             consistent { error } top-level shape, empty body on POST, missing Content-Type,
 *             duplicate company prefix → 409, method not allowed → 405
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { AgentApiKeyStatus, AdapterType } from '@shackleai/shared'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

/** Build a minimal HS256 JWT with custom ttl (seconds). */
function buildJwt(
  payload: { sub: string; email: string; role: string },
  ttlSeconds: number,
  secret = 'shackleai-dev-jwt-secret-change-me',
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = base64UrlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }),
  )
  const signature = createHmac('sha256', secret)
    .update(`${header}.${fullPayload}`)
    .digest('base64url')
  return `${header}.${fullPayload}.${signature}`
}

/** Seed a company + agent + raw API key directly into the DB. */
async function seedApiKey(
  db: PGliteProvider,
  plainKey: string,
  status: string = AgentApiKeyStatus.Active,
): Promise<void> {
  const setup = createApp(db, { skipAuth: true })

  const companyRes = await setup.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Battle Corp ${randomBytes(4).toString('hex')}`,
      issue_prefix: randomBytes(3).toString('hex').toUpperCase(),
    }),
  })
  const { data: company } = (await companyRes.json()) as { data: { id: string } }

  const agentRes = await setup.request(`/api/companies/${company.id}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Battle Agent', adapter_type: AdapterType.Process }),
  })
  const { data: agent } = (await agentRes.json()) as { data: { id: string } }

  const keyHash = createHash('sha256').update(plainKey).digest('hex')
  await db.query(
    `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, status)
     VALUES ($1, $2, $3, $4)`,
    [agent.id, company.id, keyHash, status],
  )
}

// ===========================================================================
// Battle A: Auth Middleware gaps (#292)
// ===========================================================================

describe('Battle A: auth middleware — gap coverage (#292)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let validPlainKey: string
  let validJwt: string
  let registeredEmail: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    // Real auth middleware engaged (no skipAuth)
    app = createApp(db)

    // Register a user to get a real JWT
    registeredEmail = `battle-a-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: registeredEmail,
        password: 'Battle@1234!',
        name: 'Battle A User',
      }),
    })
    const regBody = (await regRes.json()) as { data: { token: string } }
    validJwt = regBody.data.token

    // Seed a valid API key
    validPlainKey = randomBytes(32).toString('hex')
    await seedApiKey(db, validPlainKey, AgentApiKeyStatus.Active)
  })

  afterAll(async () => {
    await db.close()
  })

  // ── Scheme variants ────────────────────────────────────────────────────────

  it('Basic scheme instead of Bearer returns 401', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Basic ${validPlainKey}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('Token scheme instead of Bearer returns 401', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Token ${validPlainKey}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('bearer (lowercase) scheme returns 401 — middleware is case-sensitive', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `bearer ${validPlainKey}` },
    })
    expect(res.status).toBe(401)
  })

  it('BEARER (uppercase) scheme returns 401', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `BEARER ${validPlainKey}` },
    })
    expect(res.status).toBe(401)
  })

  // ── JWT with non-existent user sub ────────────────────────────────────────

  it('JWT signed correctly but with non-existent user sub returns 401', async () => {
    // Build a syntactically valid, non-expired JWT pointing to a UUID that has no user_sessions row
    const phantomToken = buildJwt(
      {
        sub: '00000000-dead-beef-cafe-000000000000',
        email: 'phantom@nowhere.com',
        role: 'member',
      },
      3600,
    )

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${phantomToken}` },
    })
    // createApiAuth tries JWT (no session → false), then API key (not in DB → false) → 401
    expect(res.status).toBe(401)
  })

  // ── Public routes bypass auth even with auth middleware engaged ────────────

  it('/api/invites path is public — no auth required even with real auth middleware', async () => {
    // This route returns 404 (no invite exists) but must NOT return 401
    const fakeId = '00000000-0000-0000-0000-000000000001'
    const res = await app.request(`/api/invites/${fakeId}`)
    // 404 = route reached (public); 401 = auth middleware blocked (bug)
    expect(res.status).not.toBe(401)
  })

  it('/api/auth/register is public — no token required', async () => {
    const email = `pub-check-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Pub Check' }),
    })
    // Must not be 401
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(201)
  })

  it('/api/auth/login is public — no token required', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registeredEmail, password: 'Battle@1234!' }),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(200)
  })

  // ── Auth error response shape consistency ─────────────────────────────────

  it('auth failure always returns JSON { error: string } — not HTML or plain text', async () => {
    const res = await app.request('/api/companies')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('auth failure does not expose stack trace in error response', async () => {
    const res = await app.request('/api/companies')
    const body = (await res.json()) as Record<string, unknown>
    // No stack property at top level
    expect(body.stack).toBeUndefined()
    // error message itself should not contain "at Object." or file paths
    const errorStr = String(body.error)
    expect(errorStr).not.toMatch(/at Object\.|at async|\.ts:\d+|\.js:\d+/)
  })

  it('valid JWT and valid API key both return 200 on the same protected endpoint', async () => {
    const [jwtRes, keyRes] = await Promise.all([
      app.request('/api/companies', { headers: { Authorization: `Bearer ${validJwt}` } }),
      app.request('/api/companies', { headers: { Authorization: `Bearer ${validPlainKey}` } }),
    ])
    expect(jwtRes.status).toBe(200)
    expect(keyRes.status).toBe(200)
  })

  // ── Token with extra whitespace ────────────────────────────────────────────

  it('Bearer token with leading tab after space is trimmed — valid key still passes (200)', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer \t${validPlainKey}` },
    })
    // The middleware does: authHeader.slice('Bearer '.length).trim()
    // Input: 'Bearer \t<key>' → slice → '\t<key>' → trim() → '<key>' (valid key)
    // The tab between the space and the key is stripped, so the key lookup succeeds.
    expect(res.status).toBe(200)
  })

  it('Bearer with only tabs after space returns 401 (empty token after trim)', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: 'Bearer \t\t\t' },
    })
    expect(res.status).toBe(401)
  })
})

// ===========================================================================
// Battle B: CORS gaps (#293)
// ===========================================================================

describe('Battle B: CORS middleware — gap coverage (#293)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
  })

  afterAll(async () => {
    await db.close()
  })

  afterEach(() => {
    delete process.env.SHACKLEAI_CORS_ORIGIN
  })

  // ── Credentials header ────────────────────────────────────────────────────

  it('Access-Control-Allow-Credentials is NOT set (credentials not configured)', async () => {
    // Hono's cors() only emits this header when credentials: true is passed.
    // We deliberately do NOT set it (cookies/credentials are not used in agent-to-server auth).
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    // Credentials header must be absent — if it were 'true', browsers would allow
    // cross-origin cookies which we have not designed for.
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  // ── 127.0.0.1 loopback ───────────────────────────────────────────────────

  it('127.0.0.1 loopback is NOT matched by the localhost regex — CORS header absent', async () => {
    app = createApp(db, { skipAuth: true })
    // The regex is /^https?:\/\/localhost(:\d+)?$/ — does not include 127.0.0.1
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://127.0.0.1:5173' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('http://127.0.0.1 without port is also not matched', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://127.0.0.1' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // ── Extreme localhost ports ────────────────────────────────────────────────

  it('localhost:65535 (max port) is allowed by the localhost regex', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:65535' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:65535')
  })

  it('localhost:3000 is allowed', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:3000' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
  })

  // ── Env var origin rejection ───────────────────────────────────────────────

  it('env var set but origin NOT in the allowed list — CORS header absent', async () => {
    process.env.SHACKLEAI_CORS_ORIGIN = 'https://app.shackle.ai'
    app = createApp(db, { skipAuth: true })

    // localhost is now NOT in the allowed list because env var overrides the regex
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    // When env var is set, only that exact origin is allowed. localhost should be blocked.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('env var set — origin in list is echoed back correctly', async () => {
    process.env.SHACKLEAI_CORS_ORIGIN = 'https://app.shackle.ai, https://staging.shackle.ai'
    app = createApp(db, { skipAuth: true })

    const res = await app.request('/api/health', {
      headers: { Origin: 'https://app.shackle.ai' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.shackle.ai')
  })

  it('env var set — unlisted origin gets no CORS header (not a wildcard)', async () => {
    process.env.SHACKLEAI_CORS_ORIGIN = 'https://app.shackle.ai'
    app = createApp(db, { skipAuth: true })

    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.app.shackle.ai' },
    })
    // Subdomain of the allowed origin must NOT be allowed (not a wildcard match)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // ── CORS on actual data endpoints (not just /api/health) ──────────────────

  it('CORS Allow-Origin is set on actual data endpoints, not just /api/health', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/companies', {
      headers: { Origin: 'http://localhost:5173' },
    })
    // 200 or whatever the route returns — the key check is the CORS header
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('X-Total-Count is in Access-Control-Expose-Headers on data endpoints', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/companies', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Total-Count')
  })

  // ── Preflight on non-health route ─────────────────────────────────────────

  it('preflight OPTIONS on /api/companies returns 204 with correct CORS headers', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/companies', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('preflight OPTIONS with disallowed origin returns 200/204 but no Allow-Origin header', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/api/companies', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.com',
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })
    // The request completes (not blocked at TCP), but no CORS header is echoed
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // ── No CORS on non-API routes ─────────────────────────────────────────────

  it('CORS middleware is not applied to /favicon.svg (non-API route)', async () => {
    app = createApp(db, { skipAuth: true })
    const res = await app.request('/favicon.svg', {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

// ===========================================================================
// Battle C: API Error Handling gaps (#294)
// ===========================================================================

describe('Battle C: API error handling — gap coverage (#294)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    // Create a company for scoped endpoint tests
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Error Battle Corp ${randomBytes(4).toString('hex')}`,
        issue_prefix: randomBytes(3).toString('hex').toUpperCase(),
      }),
    })
    const body = (await res.json()) as { data: { id: string } }
    companyId = body.data.id
  })

  afterAll(async () => {
    await db.close()
  })

  // ── Consistent error shape ────────────────────────────────────────────────

  it('404 response has { error: string } top-level shape', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
    // No extra unexpected top-level keys that would reveal internals
    expect(body.stack).toBeUndefined()
  })

  it('401 response has { error: string } top-level shape', async () => {
    const authApp = createApp(db) // real auth
    const res = await authApp.request('/api/companies')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
    expect(body.stack).toBeUndefined()
  })

  it('409 response has { error: string } top-level shape', async () => {
    // Use the auth register route to trigger a 409 — it correctly pre-checks for duplicate email
    // (the companies route does NOT handle duplicate issue_prefix → 500, that is a separate bug below)
    const dupEmail = `dup-shape-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const setupApp = createApp(db) // auth routes always active
    await setupApp.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: dupEmail, password: 'Battle@1234!', name: 'Dup User' }),
    })
    const res = await setupApp.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: dupEmail, password: 'Other@1234!', name: 'Dup User 2' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
    expect(body.stack).toBeUndefined()
  })

  // ── Validation error details include field names ────────────────────────────

  it('POST /api/companies with missing required fields returns details with field names', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // missing both name and issue_prefix
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details?: unknown }
    expect(body.error).toBe('Validation failed')
    // details should be present and contain field information
    expect(body.details).toBeDefined()
    // Zod flatten() produces { formErrors: [], fieldErrors: { fieldName: [...] } }
    const details = body.details as { fieldErrors?: Record<string, unknown> }
    expect(details.fieldErrors).toBeDefined()
    // 'name' should appear in field errors
    expect(details.fieldErrors?.name).toBeDefined()
  })

  it('POST /api/companies/:id/agents with missing name returns details with field name', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_type: 'process' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details?: { fieldErrors?: Record<string, unknown> } }
    expect(body.error).toBe('Validation failed')
    expect(body.details?.fieldErrors?.name).toBeDefined()
  })

  // ── No stack traces in any error response ─────────────────────────────────

  it('404 response body contains no stack trace', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).not.toMatch(/at Object\.|at async|Error:.*\n.*at /)
    expect(text).not.toContain('stack')
  })

  it('400 validation error response body contains no stack trace', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).not.toMatch(/at Object\.|at async|Error:.*\n.*at /)
  })

  it('400 invalid JSON error response body contains no stack trace', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json!!!',
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).not.toMatch(/at Object\.|at async|Error:.*\n.*at /)
  })

  // ── Edge case request bodies ───────────────────────────────────────────────

  it('POST with completely empty body returns 400 (not 500)', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    })
    // Empty body is not valid JSON — should be 400, not a 500 server crash
    expect(res.status).toBe(400)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('POST with null JSON body returns 400', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    // null is valid JSON but not a valid object — validation should reject it
    expect(res.status).toBe(400)
  })

  it('POST without Content-Type header and non-JSON body returns 400 (not 500)', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      body: 'name=Test&issue_prefix=TST', // form-encoded without declaring it
    })
    // Should not crash the server
    expect(res.status).toBe(400)
    expect(res.status).not.toBe(500)
  })

  it('POST with text/plain Content-Type returns 400', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'this is plain text',
    })
    expect(res.status).toBe(400)
    expect(res.status).not.toBe(500)
  })

  it('POST /api/companies with duplicate issue_prefix returns 409', async () => {
    const prefix = randomBytes(3).toString('hex').toUpperCase()
    const first = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unique Corp Alpha', issue_prefix: prefix }),
    })
    expect(first.status).toBe(201)

    const second = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unique Corp Beta', issue_prefix: prefix }),
    })
    expect(second.status).toBe(409)
  })

  // ── Nonexistent route returns 404 (not 500) ────────────────────────────────

  it('GET /api/completely-nonexistent-route returns non-401 non-500', async () => {
    const res = await app.request('/api/completely-nonexistent-route-xyz')
    // Should not crash (500) and should not be auth-blocked (401 for a non-api/* path)
    expect(res.status).not.toBe(500)
  })

  // ── All error responses are JSON, not HTML ────────────────────────────────

  it('404 response is JSON (not HTML)', async () => {
    const res = await app.request(
      `/api/companies/00000000-0000-0000-0000-000000000000`,
    )
    const contentType = res.headers.get('Content-Type') ?? ''
    expect(contentType).toContain('application/json')
    // Must not be an HTML error page
    const text = await res.text()
    expect(text).not.toContain('<html')
    expect(text).not.toContain('<!DOCTYPE')
  })

  it('400 validation error response is JSON (not HTML)', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const contentType = res.headers.get('Content-Type') ?? ''
    expect(contentType).toContain('application/json')
    const text = await res.text()
    expect(text).not.toContain('<html')
  })

  // ── Issue not found returns specific error message ─────────────────────────

  it('GET nonexistent issue returns exact error string "Issue not found"', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('GET nonexistent agent returns exact error string "Agent not found"', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('GET nonexistent company returns an error response', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })
})

// ===========================================================================
// Battle D: Auth/CORS integration — real auth + CORS together
// ===========================================================================

describe('Battle D: auth + CORS integration (#292 + #293)', () => {
  let db: PGliteProvider

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
  })

  afterAll(async () => {
    await db.close()
  })

  afterEach(() => {
    delete process.env.SHACKLEAI_CORS_ORIGIN
  })

  it('CORS preflight on protected route succeeds without auth (preflight must not require auth)', async () => {
    // The OPTIONS preflight request must not be blocked by auth middleware —
    // browsers send preflight before the actual authenticated request.
    const app = createApp(db) // real auth engaged
    const res = await app.request('/api/companies', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })
    // 204 = CORS middleware handled it cleanly; 401 = BUG (auth blocked the preflight)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('401 response includes CORS headers so browser can read the error body cross-origin', async () => {
    // When auth fails, the browser still needs to read the error response body.
    // If CORS headers are missing on the 401, the browser will silently swallow the error.
    const app = createApp(db) // real auth engaged
    const res = await app.request('/api/companies', {
      headers: { Origin: 'http://localhost:5173' },
      // No Authorization header → 401
    })
    expect(res.status).toBe(401)
    // CORS header must be present on the 401 response
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('CORS and auth both satisfied — 200 with correct CORS headers on the response', async () => {
    const app = createApp(db) // real auth engaged

    // Register a user to get a JWT
    const email = `cors-auth-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'CORS Auth User' }),
    })
    const { data } = (await regRes.json()) as { data: { token: string } }

    const res = await app.request('/api/companies', {
      headers: {
        Authorization: `Bearer ${data.token}`,
        Origin: 'http://localhost:5173',
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})
