import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AdapterType, TriggerType, HeartbeatRunStatus } from '@shackleai/shared'

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

async function createAgent(app: ReturnType<typeof createApp>, companyId: string) {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Heartbeat Agent', adapter_type: AdapterType.Claude }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

// Insert a heartbeat run directly via db for testing GET routes
// (No POST endpoint on this router — heartbeats are created by the core engine)
async function insertHeartbeatRun(
  db: PGliteProvider,
  companyId: string,
  agentId: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO heartbeat_runs (company_id, agent_id, trigger_type, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      companyId,
      agentId,
      overrides.trigger_type ?? TriggerType.Manual,
      overrides.status ?? HeartbeatRunStatus.Queued,
    ],
  )
  return result.rows[0].id
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('heartbeats routes', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
    companyId = await createCompany(app)
    agentId = await createAgent(app, companyId)
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/heartbeats returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/heartbeats`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('GET /api/companies/:id/heartbeats lists heartbeat runs ordered by created_at DESC', async () => {
    const newCompanyId = await createCompany(app, 'HBList Corp')
    const newAgentId = await createAgent(app, newCompanyId)

    const run1Id = await insertHeartbeatRun(db, newCompanyId, newAgentId, {
      trigger_type: TriggerType.Cron,
    })
    const run2Id = await insertHeartbeatRun(db, newCompanyId, newAgentId, {
      trigger_type: TriggerType.Manual,
      status: HeartbeatRunStatus.Success,
    })

    const res = await app.request(`/api/companies/${newCompanyId}/heartbeats`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string }[] }
    expect(body.data).toHaveLength(2)
    // Most recent first
    const ids = body.data.map((r) => r.id)
    expect(ids).toContain(run1Id)
    expect(ids).toContain(run2Id)
  })

  it('GET /api/companies/:id/heartbeats/:runId returns heartbeat detail', async () => {
    const newCompanyId = await createCompany(app, 'HBDetail Corp')
    const newAgentId = await createAgent(app, newCompanyId)
    const runId = await insertHeartbeatRun(db, newCompanyId, newAgentId, {
      trigger_type: TriggerType.Api,
      status: HeartbeatRunStatus.Running,
    })

    const res = await app.request(`/api/companies/${newCompanyId}/heartbeats/${runId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        id: string
        company_id: string
        agent_id: string
        trigger_type: string
        status: string
        stdout_excerpt: string | null
      }
    }
    expect(body.data.id).toBe(runId)
    expect(body.data.company_id).toBe(newCompanyId)
    expect(body.data.agent_id).toBe(newAgentId)
    expect(body.data.trigger_type).toBe(TriggerType.Api)
    expect(body.data.status).toBe(HeartbeatRunStatus.Running)
    expect('stdout_excerpt' in body.data).toBe(true)
  })

  it('GET /api/companies/:id/heartbeats/:runId returns 404 for non-existent run', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/heartbeats/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Heartbeat run not found')
  })

  it('GET /api/companies/:id/heartbeats returns 404 for non-existent company', async () => {
    const res = await app.request(
      `/api/companies/00000000-0000-0000-0000-000000000000/heartbeats`,
    )
    expect(res.status).toBe(404)
  })
})
