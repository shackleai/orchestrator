import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AgentStatus, AdapterType } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: ReturnType<typeof createApp>, name = 'Test Corp') {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: name.toUpperCase().slice(0, 4) }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alpha Agent',
      adapter_type: AdapterType.Claude,
      ...overrides,
    }),
  })
  return res
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('agents routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app)
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/agents returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/agents creates agent', async () => {
    const res = await createAgent(app, companyId)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { id: string; name: string; status: string; adapter_type: string }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.name).toBe('Alpha Agent')
    expect(body.data.status).toBe(AgentStatus.Idle)
    expect(body.data.adapter_type).toBe(AdapterType.Claude)
  })

  it('POST /api/companies/:id/agents returns 400 on missing required fields', async () => {
    // name is required and must be non-empty; omitting it entirely triggers validation failure
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_type: AdapterType.Claude }), // missing name
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/agents returns 400 on empty name', async () => {
    const res = await createAgent(app, companyId, { name: '' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/agents returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/companies/:id/agents returns 404 for non-existent company', async () => {
    const res = await createAgent(app, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/agents/:agentId returns agent detail', async () => {
    const createRes = await createAgent(app, companyId, { name: 'Beta Agent' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; name: string } }
    expect(body.data.id).toBe(agentId)
    expect(body.data.name).toBe('Beta Agent')
  })

  it('GET /api/companies/:id/agents/:agentId returns 404 for non-existent agent', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('PATCH /api/companies/:id/agents/:agentId updates agent fields', async () => {
    const createRes = await createAgent(app, companyId, { name: 'Gamma Agent' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gamma Agent Updated' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string } }
    expect(body.data.name).toBe('Gamma Agent Updated')
  })

  it('PATCH /api/companies/:id/agents/:agentId returns 404 for non-existent agent', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH /api/companies/:id/agents/:agentId returns 400 on validation error', async () => {
    const createRes = await createAgent(app, companyId, { name: 'Delta Agent' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/companies/:id/agents lists multiple agents', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

describe('agents routes — lifecycle', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Lifecycle Corp')

    const res = await createAgent(app, companyId, { name: 'Lifecycle Agent', adapter_type: AdapterType.Process })
    const body = (await res.json()) as { data: { id: string } }
    agentId = body.data.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST /:agentId/pause sets status to paused', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Paused)
  })

  it('POST /:agentId/resume sets status to idle', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/resume`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Idle)
  })

  it('POST /:agentId/terminate sets status to terminated', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/terminate`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  it('POST /:agentId/wakeup updates last_heartbeat_at (no scheduler fallback)', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/wakeup`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean; agent: { last_heartbeat_at: string } } }
    // Without a scheduler, triggered is false (fallback mode)
    expect(body.data.triggered).toBe(false)
    expect(body.data.agent.last_heartbeat_at).toBeTruthy()
  })

  it('lifecycle actions return 404 for non-existent agent', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000'
    for (const action of ['pause', 'resume', 'terminate', 'wakeup']) {
      const res = await app.request(
        `/api/companies/${companyId}/agents/${ghost}/${action}`,
        { method: 'POST' },
      )
      expect(res.status).toBe(404)
    }
  })
})

// ---------------------------------------------------------------------------
// API key generation + auth middleware
// ---------------------------------------------------------------------------

describe('agents routes — API key generation', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Key Corp')

    const res = await createAgent(app, companyId, { name: 'Key Agent' })
    const body = (await res.json()) as { data: { id: string } }
    agentId = body.data.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST /:agentId/api-keys generates a key and returns it once', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'ci-runner' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        agent_id: string
        company_id: string
        label: string
        status: string
        key: string
      }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.agent_id).toBe(agentId)
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.label).toBe('ci-runner')
    expect(body.data.status).toBe('active')
    // key is a 64-char hex string (32 random bytes)
    expect(body.data.key).toMatch(/^[0-9a-f]{64}$/)
    // key_hash must NOT be returned in the response
    expect('key_hash' in body.data).toBe(false)
  })

  it('POST /:agentId/api-keys without label still succeeds', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, {
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { key: string; label: string | null } }
    expect(body.data.key).toMatch(/^[0-9a-f]{64}$/)
    expect(body.data.label).toBeNull()
  })

  it('POST /:agentId/api-keys returns 404 for non-existent agent', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/api-keys`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })

  it('each call generates a unique key', async () => {
    const [r1, r2] = await Promise.all([
      app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, { method: 'POST' }),
      app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, { method: 'POST' }),
    ])
    const b1 = (await r1.json()) as { data: { key: string } }
    const b2 = (await r2.json()) as { data: { key: string } }
    expect(b1.data.key).not.toBe(b2.data.key)
  })
})
