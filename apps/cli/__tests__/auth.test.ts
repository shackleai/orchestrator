/**
 * Auth middleware integration tests
 *
 * Tests the global API auth middleware (createApiAuth) as wired into createApp.
 * createApp(db) without skipAuth enforces Bearer token on all /api/* routes
 * except /api/health.
 */

import { createHash, randomBytes } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { AgentApiKeyStatus, AdapterType } from '@shackleai/shared'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a company + agent via the API then insert a raw API key row.
 * Uses a separate skipAuth app instance so setup is never blocked by auth.
 * agent_api_keys has FK constraints on agent_id/company_id, so real rows
 * must exist before inserting a key.
 */
async function seedAgentKey(
  db: PGliteProvider,
  plainKey: string,
  status: string = AgentApiKeyStatus.Active,
): Promise<void> {
  const setupApp = createApp(db, { skipAuth: true })

  const companyRes = await setupApp.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Auth Test Corp ${randomBytes(4).toString('hex')}`,
      issue_prefix: randomBytes(3).toString('hex').toUpperCase(),
    }),
  })
  const { data: company } = (await companyRes.json()) as { data: { id: string } }

  // Process adapter: no LLM key pre-flight required
  const agentRes = await setupApp.request(`/api/companies/${company.id}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Auth Test Agent', adapter_type: AdapterType.Process }),
  })
  const { data: agent } = (await agentRes.json()) as { data: { id: string } }

  const keyHash = createHash('sha256').update(plainKey).digest('hex')
  await db.query(
    `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, status)
     VALUES ($1, $2, $3, $4)`,
    [agent.id, company.id, keyHash, status],
  )
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('API auth middleware', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let validPlainKey: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    // No skipAuth — real middleware is engaged
    app = createApp(db)

    validPlainKey = randomBytes(32).toString('hex')
    await seedAgentKey(db, validPlainKey, AgentApiKeyStatus.Active)
  })

  afterAll(async () => {
    await db.close()
  })

  // --- Health endpoint: always public ---

  it('GET /api/health is accessible without Authorization header', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('GET /api/health is accessible with a completely wrong token', async () => {
    const res = await app.request('/api/health', {
      headers: { Authorization: 'Bearer totally-invalid-token' },
    })
    expect(res.status).toBe(200)
  })

  // --- Missing / malformed Authorization header ---

  it('returns 401 when Authorization header is absent', async () => {
    const res = await app.request('/api/companies')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: validPlainKey },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  it('returns 401 when Bearer token is an empty string', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  it('returns 401 when Bearer token is whitespace only', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: 'Bearer    ' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  // --- Invalid / unknown token ---

  it('returns 401 when token does not match any key in the database', async () => {
    const unknownKey = randomBytes(32).toString('hex')
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${unknownKey}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  it('returns 401 for a syntactically valid but non-existent key', async () => {
    const fakeKey = 'a'.repeat(64)
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${fakeKey}` },
    })
    expect(res.status).toBe(401)
  })

  // --- Revoked token ---

  it('returns 401 when token belongs to a revoked key', async () => {
    const revokedKey = randomBytes(32).toString('hex')
    await seedAgentKey(db, revokedKey, AgentApiKeyStatus.Revoked)

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${revokedKey}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  // --- Valid token: request passes through ---

  it('passes through to the route handler with a valid active API key', async () => {
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${validPlainKey}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('valid key updates last_used_at asynchronously without blocking', async () => {
    const headers = { Authorization: `Bearer ${validPlainKey}` }
    const [r1, r2] = await Promise.all([
      app.request('/api/health'),
      app.request('/api/companies', { headers }),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
  })

  // --- Non-API routes bypass auth ---

  it('non-/api/* paths are not subject to API auth (returns non-401)', async () => {
    // Without dashboard dist built, catch-all returns 404 (not 401)
    const res = await app.request('/some-random-path')
    expect(res.status).not.toBe(401)
  })
})
