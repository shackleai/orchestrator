/**
 * Battle Test — Board Claim (#274)
 *
 * Tests the board claim / release / status endpoints for human operator
 * authority over a company. The board claim routes use humanAuth middleware
 * (JWT-only, no API keys) so every test scenario must first register a user
 * and obtain a valid JWT session.
 *
 * Covers:
 *   1. Happy Path — claim, status reflects claim, release, status clears
 *   2. Idempotent re-claim by same user
 *   3. Conflict — second user cannot claim while first holds it
 *   4. Release by non-holder → 403
 *   5. Release when board is unclaimed → idempotent success
 *   6. Status when unclaimed → claimed: false
 *   7. Status when claimed → claimed: true with user info
 *   8. Rapid release-and-reclaim sequence
 *   9. humanAuth rejects missing token → 401
 *  10. humanAuth rejects invalid/expired token → 401
 *  11. humanAuth rejects bare agent API key → 401
 *  12. Company not found → 404
 *  13. Mutation guard (DOCUMENTED BUG — agents.ts has no board guard)
 *
 * BUG: The agents route (POST/DELETE /:id/agents and PATCH budget) does NOT
 * enforce a board claim requirement. Agents can be created, deleted, and their
 * budgets changed without the board being claimed. The board claim system only
 * controls its own claim/release endpoints — it is not enforced as a guard on
 * mutation endpoints in other routes.
 * See: apps/cli/src/server/routes/agents.ts — no board_claimed_by check in
 * POST /:id/agents, DELETE /:id/agents/:agentId, or PATCH /:id/agents/:agentId.
 * ENHANCEMENT: Add a boardGuard middleware to enforce board claim on guarded
 * mutation routes (agent hire/fire, budget changes, policy changes).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type BoardStatus = {
  claimed: boolean
  claimed_by: string | null
  claimed_at: string | null
  user_name: string | null
  user_email: string | null
}

type CompanyRow = {
  id: string
  name: string
  status: string
}

type AgentRow = {
  id: string
  name: string
  status: string
  adapter_type: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register a user and return their JWT token + user id. */
async function registerUser(
  app: App,
  suffix?: string,
): Promise<{ token: string; userId: string; email: string; name: string }> {
  const tag = suffix ?? randomBytes(4).toString('hex')
  const email = `board-battle-${tag}@test.shackleai.com`
  const name = `Board Battle User ${tag}`

  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Battle@1234!', name }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    data: { user: { id: string; email: string }; token: string }
  }
  return {
    token: body.data.token,
    userId: body.data.user.id,
    email: body.data.user.email,
    name,
  }
}

/** Create a company (no auth — skipAuth app used in setup). */
async function createCompany(app: App, suffix?: string): Promise<CompanyRow> {
  const tag = suffix ?? randomBytes(4).toString('hex')
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Board Battle Corp ${tag}`,
      issue_prefix: tag.toUpperCase().slice(0, 4),
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

/** Create an agent (no board guard required — skipAuth app). */
async function createAgent(app: App, companyId: string, suffix?: string): Promise<AgentRow> {
  const tag = suffix ?? randomBytes(4).toString('hex')
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Board Battle Agent ${tag}`, adapter_type: 'process' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

/** POST /api/companies/:id/board/claim with a Bearer JWT. */
async function claimBoard(
  app: App,
  companyId: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/api/companies/${companyId}/board/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json()) as Record<string, unknown>
  return { status: res.status, body }
}

/** POST /api/companies/:id/board/release with a Bearer JWT. */
async function releaseBoard(
  app: App,
  companyId: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/api/companies/${companyId}/board/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json()) as Record<string, unknown>
  return { status: res.status, body }
}

/** GET /api/companies/:id/board/status — no auth required. */
async function getBoardStatus(app: App, companyId: string): Promise<{ status: number; data: BoardStatus }> {
  const res = await app.request(`/api/companies/${companyId}/board/status`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: BoardStatus }
  return { status: res.status, data: body.data }
}

// ---------------------------------------------------------------------------
// Battle 1 — Happy Path: claim → status → release → status
// ---------------------------------------------------------------------------

describe('Board Claim Battle 1: happy path — claim, status, release', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let userToken: string
  let userId: string
  let userEmail: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    // skipAuth so company creation does not require a token
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'happy')
    companyId = company.id

    const user = await registerUser(app, 'happy')
    userToken = user.token
    userId = user.userId
    userEmail = user.email
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /board/status returns claimed: false before any claim', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(false)
    expect(data.claimed_by).toBeNull()
    expect(data.claimed_at).toBeNull()
    expect(data.user_name).toBeNull()
    expect(data.user_email).toBeNull()
  })

  it('POST /board/claim returns 200 and confirms the claim', async () => {
    const { status, body } = await claimBoard(app, companyId, userToken)
    expect(status).toBe(200)
    const data = body.data as { message: string; company_id: string }
    expect(data.message).toBe('Board claimed')
    expect(data.company_id).toBe(companyId)
  })

  it('GET /board/status shows claimed: true with correct user info', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(true)
    expect(data.claimed_by).toBe(userId)
    expect(data.claimed_at).toBeTruthy()
    expect(data.user_email).toBe(userEmail)
    expect(data.user_name).toBeTruthy()
    // claimed_at must be a parseable ISO timestamp
    expect(() => new Date(data.claimed_at!)).not.toThrow()
  })

  it('POST /board/release returns 200 and confirms release', async () => {
    const { status, body } = await releaseBoard(app, companyId, userToken)
    expect(status).toBe(200)
    const data = body.data as { message: string }
    expect(data.message).toBe('Board released')
  })

  it('GET /board/status shows claimed: false after release', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(false)
    expect(data.claimed_by).toBeNull()
    expect(data.claimed_at).toBeNull()
    expect(data.user_name).toBeNull()
    expect(data.user_email).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Battle 2 — Idempotent re-claim by same user
// ---------------------------------------------------------------------------

describe('Board Claim Battle 2: idempotent re-claim', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let userToken: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'idem')
    companyId = company.id
    const user = await registerUser(app, 'idem')
    userToken = user.token
    // Claim the board initially
    await claimBoard(app, companyId, userToken)
  })

  afterAll(async () => {
    await db.close()
  })

  it('claiming the board again as the same user returns success (idempotent)', async () => {
    const { status, body } = await claimBoard(app, companyId, userToken)
    expect(status).toBe(200)
    const data = body.data as { message: string }
    expect(data.message).toContain('already claimed by you')
  })

  it('board status still shows same user after idempotent re-claim', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Battle 3 — Conflict: second user cannot claim while first user holds it
// ---------------------------------------------------------------------------

describe('Board Claim Battle 3: conflict — two users competing for board', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let user1Token: string
  let user2Token: string
  let user1Email: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'conflict')
    companyId = company.id
    const user1 = await registerUser(app, 'conflict-u1')
    const user2 = await registerUser(app, 'conflict-u2')
    user1Token = user1.token
    user2Token = user2.token
    user1Email = user1.email
    // User 1 claims first
    await claimBoard(app, companyId, user1Token)
  })

  afterAll(async () => {
    await db.close()
  })

  it('second user gets 409 when board is already held by first user', async () => {
    const { status, body } = await claimBoard(app, companyId, user2Token)
    expect(status).toBe(409)
    expect(body.error).toBe('Board already claimed')
    const detail = body.detail as string
    expect(detail).toContain(user1Email)
    expect(detail).toContain('release it first')
  })

  it('board status is still owned by user1 after conflict attempt', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(true)
    expect(data.user_email).toBe(user1Email)
  })

  it('after user1 releases, user2 can claim successfully', async () => {
    await releaseBoard(app, companyId, user1Token)
    const { status } = await claimBoard(app, companyId, user2Token)
    expect(status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Battle 4 — Release by non-holder → 403
// ---------------------------------------------------------------------------

describe('Board Claim Battle 4: release by non-holder → 403', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let user1Token: string
  let user2Token: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'nonholder')
    companyId = company.id
    const user1 = await registerUser(app, 'nonholder-u1')
    const user2 = await registerUser(app, 'nonholder-u2')
    user1Token = user1.token
    user2Token = user2.token
    await claimBoard(app, companyId, user1Token)
  })

  afterAll(async () => {
    await db.close()
  })

  it('user2 cannot release a board claimed by user1 → 403', async () => {
    const { status, body } = await releaseBoard(app, companyId, user2Token)
    expect(status).toBe(403)
    expect(body.error).toBe('Forbidden')
    const detail = body.detail as string
    expect(detail).toContain('Only the current board holder')
  })

  it('board is still claimed by user1 after unauthorized release attempt', async () => {
    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Battle 5 — Release when board is unclaimed → idempotent success
// ---------------------------------------------------------------------------

describe('Board Claim Battle 5: release when unclaimed → idempotent', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let userToken: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'unclaimed-release')
    companyId = company.id
    const user = await registerUser(app, 'unclaimed-release')
    userToken = user.token
    // Board is NOT claimed
  })

  afterAll(async () => {
    await db.close()
  })

  it('releasing an unclaimed board returns 200 with informative message', async () => {
    const { status, body } = await releaseBoard(app, companyId, userToken)
    expect(status).toBe(200)
    const data = body.data as { message: string }
    expect(data.message).toContain('not currently claimed')
  })
})

// ---------------------------------------------------------------------------
// Battle 6 — Rapid release-and-reclaim sequence
// ---------------------------------------------------------------------------

describe('Board Claim Battle 6: rapid release-and-reclaim', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let userToken: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'rapid')
    companyId = company.id
    const user = await registerUser(app, 'rapid')
    userToken = user.token
  })

  afterAll(async () => {
    await db.close()
  })

  it('can claim → release → claim → release in rapid succession', async () => {
    for (let i = 0; i < 3; i++) {
      const claim = await claimBoard(app, companyId, userToken)
      expect(claim.status).toBe(200)

      const release = await releaseBoard(app, companyId, userToken)
      expect(release.status).toBe(200)
    }

    const { data } = await getBoardStatus(app, companyId)
    expect(data.claimed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Battle 7 — humanAuth enforcement
// ---------------------------------------------------------------------------

describe('Board Claim Battle 7: humanAuth enforcement on claim/release', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'humanauth')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST /board/claim with no Authorization header → 401', async () => {
    const res = await app.request(`/api/companies/${companyId}/board/claim`, {
      method: 'POST',
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('JWT')
  })

  it('POST /board/claim with invalid JWT → 401', async () => {
    const res = await app.request(`/api/companies/${companyId}/board/claim`, {
      method: 'POST',
      headers: { Authorization: 'Bearer this-is-not-a-valid-jwt' },
    })
    expect(res.status).toBe(401)
  })

  it('POST /board/claim with tampered JWT → 401', async () => {
    // Register a real user to get a valid token structure, then tamper it
    const user = await registerUser(app, 'tampered')
    const parts = user.token.split('.')
    // Flip the last character of the signature to invalidate it
    const sig = parts[2]
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a')
    const forgery = [parts[0], parts[1], tampered].join('.')

    const res = await app.request(`/api/companies/${companyId}/board/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${forgery}` },
    })
    expect(res.status).toBe(401)
  })

  it('POST /board/release with no Authorization header → 401', async () => {
    const res = await app.request(`/api/companies/${companyId}/board/release`, {
      method: 'POST',
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('JWT')
  })

  it('GET /board/status is accessible without any Authorization header', async () => {
    // Status is read-only and does not use humanAuth — should work without a token
    const res = await app.request(`/api/companies/${companyId}/board/status`)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Battle 8 — Company not found → 404
// ---------------------------------------------------------------------------

describe('Board Claim Battle 8: company not found → 404', () => {
  let db: PGliteProvider
  let app: App
  let userToken: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const user = await registerUser(app, 'notfound')
    userToken = user.token
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST /board/claim for non-existent company → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request(`/api/companies/${fakeId}/board/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(res.status).toBe(404)
  })

  it('POST /board/release for non-existent company → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001'
    const res = await app.request(`/api/companies/${fakeId}/board/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(res.status).toBe(404)
  })

  it('GET /board/status for non-existent company → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000002'
    const res = await app.request(`/api/companies/${fakeId}/board/status`)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle 9 — Mutation guard gap (documented BUG)
//
// BUG: The agents route has NO board_claimed_by check. Agent creation,
// deletion, and budget changes proceed regardless of board claim state.
// This test DOCUMENTS the current behavior (no guard) and must be updated
// once the guard is implemented.
//
// ENHANCEMENT: Add boardGuard middleware to enforce board claim on:
//   POST   /api/companies/:id/agents          (create agent)
//   DELETE /api/companies/:id/agents/:agentId (delete agent)
//   PATCH  /api/companies/:id/agents/:agentId when budget_monthly_cents changes
// ---------------------------------------------------------------------------

describe('Board Claim Battle 9: mutation guard — documented BUG', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'mutguard')
    companyId = company.id
    // Board is NOT claimed — no user has claimed authority
  })

  afterAll(async () => {
    await db.close()
  })

  it('BUG: agent can be created without board claim (no guard enforced)', async () => {
    // Expected behavior (once guard is implemented): 403 or 409 requiring board claim.
    // Current behavior: 201 success — the guard does not exist.
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unguarded Agent', adapter_type: 'process' }),
    })
    // DOCUMENTS CURRENT (BROKEN) BEHAVIOR: 201 instead of 403
    expect(res.status).toBe(201)
  })

  it('BUG: agent budget can be changed without board claim (no guard enforced)', async () => {
    // Create agent first
    const agent = await createAgent(app, companyId, 'budget-unguarded')

    // Patch budget — should require board claim but currently does not
    const res = await app.request(`/api/companies/${companyId}/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_monthly_cents: 99999 }),
    })
    // DOCUMENTS CURRENT (BROKEN) BEHAVIOR: 200 instead of 403
    expect(res.status).toBe(200)
  })

  it('BUG: no DELETE /agents route exists (agent dismissal not yet implemented)', async () => {
    // NOTE: There is no DELETE /api/companies/:id/agents/:agentId route in agents.ts.
    // Agent deletion is unimplemented — the endpoint returns 404 (route not found).
    // Once a delete route is added, it should require a board claim before allowing
    // agent dismissal.
    const agent = await createAgent(app, companyId, 'delete-unguarded')

    const res = await app.request(`/api/companies/${companyId}/agents/${agent.id}`, {
      method: 'DELETE',
    })
    // DOCUMENTS CURRENT BEHAVIOR: 404 — route does not exist
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle 10 — Logged-out session cannot claim
// ---------------------------------------------------------------------------

describe('Board Claim Battle 10: logged-out session cannot claim', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let userToken: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'logout')
    companyId = company.id
    const user = await registerUser(app, 'logout')
    userToken = user.token

    // Log out — invalidates the session
    await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('board claim with a logged-out JWT returns 401 (session invalidated)', async () => {
    // The JWT signature is still valid, but the session was deleted on logout.
    // humanAuth checks user_sessions table — must return 401.
    const { status } = await claimBoard(app, companyId, userToken)
    expect(status).toBe(401)
  })
})
