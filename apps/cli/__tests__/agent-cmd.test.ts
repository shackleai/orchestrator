import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AdapterType, AgentStatus } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  name = 'CLI Test Corp',
) {
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
      name: 'CLI Agent',
      adapter_type: AdapterType.Claude,
      ...overrides,
    }),
  })
  return res
}

// ---------------------------------------------------------------------------
// Tests — agent CLI command API calls
// ---------------------------------------------------------------------------

describe('agent CLI command — API integration', () => {
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

  it('list agents returns empty array initially', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('create agent via API and list it', async () => {
    const createRes = await createAgent(app, companyId, {
      name: 'TestBot',
      role: 'worker',
      adapter_type: AdapterType.Process,
    })
    expect(createRes.status).toBe(201)

    const listRes = await app.request(`/api/companies/${companyId}/agents`)
    const body = (await listRes.json()) as {
      data: { name: string; role: string; adapter_type: string }[]
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('TestBot')
    expect(body.data[0].role).toBe('worker')
    expect(body.data[0].adapter_type).toBe(AdapterType.Process)
  })

  it('pause agent sets status to paused', async () => {
    const createRes = await createAgent(app, companyId, { name: 'PauseBot' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/pause`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Paused)
  })

  it('resume agent sets status to idle', async () => {
    const createRes = await createAgent(app, companyId, { name: 'ResumeBot' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    // Pause first
    await app.request(
      `/api/companies/${companyId}/agents/${agentId}/pause`,
      { method: 'POST' },
    )

    // Resume
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/resume`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Idle)
  })

  it('terminate agent sets status to terminated', async () => {
    const createRes = await createAgent(app, companyId, { name: 'TermBot' })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/terminate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { status: string } }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  it('wakeup agent triggers heartbeat', async () => {
    const createRes = await createAgent(app, companyId, { name: 'WakeBot', adapter_type: AdapterType.Process })
    const created = (await createRes.json()) as { data: { id: string } }
    const agentId = created.data.id

    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/wakeup`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { triggered: boolean; agent: { last_heartbeat_at: string } }
    }
    // No scheduler in test app — wakeup falls back to timestamp-only update
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
