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
    body: JSON.stringify({ name: 'TC Agent', adapter_type: AdapterType.Claude }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function insertHeartbeatRun(db: PGliteProvider, companyId: string, agentId: string) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO heartbeat_runs (company_id, agent_id, trigger_type, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [companyId, agentId, TriggerType.Manual, HeartbeatRunStatus.Success],
  )
  return result.rows[0].id
}

async function insertToolCall(
  db: PGliteProvider,
  runId: string,
  agentId: string,
  companyId: string,
  toolName: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO tool_calls (heartbeat_run_id, agent_id, company_id, tool_name, tool_input, tool_output, duration_ms, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      runId,
      agentId,
      companyId,
      toolName,
      overrides.tool_input ? JSON.stringify(overrides.tool_input) : null,
      (overrides.tool_output as string) ?? null,
      (overrides.duration_ms as number) ?? null,
      (overrides.status as string) ?? 'success',
    ],
  )
  return result.rows[0].id
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('tool-calls routes', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string
  let runId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'ToolCall Corp')
    agentId = await createAgent(app, companyId)
    runId = await insertHeartbeatRun(db, companyId, agentId)

    // Insert some tool calls
    await insertToolCall(db, runId, agentId, companyId, 'read_file', {
      tool_input: { path: '/src/index.ts' },
      tool_output: 'file contents',
      duration_ms: 100,
    })
    await insertToolCall(db, runId, agentId, companyId, 'write_file', {
      tool_input: { path: '/src/out.ts' },
      duration_ms: 200,
    })
    await insertToolCall(db, runId, agentId, companyId, 'bash', {
      status: 'error',
      duration_ms: 50,
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/tool-calls returns all tool calls for the company', async () => {
    const res = await app.request(`/api/companies/${companyId}/tool-calls`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tool_name: string }[] }
    expect(body.data).toHaveLength(3)
  })

  it('GET /api/companies/:id/tool-calls?run_id= filters by heartbeat run', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?run_id=${runId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tool_name: string }[] }
    expect(body.data).toHaveLength(3)
  })

  it('GET /api/companies/:id/tool-calls?agent_id= filters by agent', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?agent_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tool_name: string }[] }
    expect(body.data).toHaveLength(3)
  })

  it('GET /api/companies/:id/tool-calls?tool_name= filters by tool name', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?tool_name=read_file`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tool_name: string }[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].tool_name).toBe('read_file')
  })

  it('GET /api/companies/:id/tool-calls?run_id= returns empty for unknown run', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?run_id=00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('returns 404 for non-existent company', async () => {
    const res = await app.request(
      `/api/companies/00000000-0000-0000-0000-000000000000/tool-calls`,
    )
    expect(res.status).toBe(404)
  })

  it('supports pagination with limit and offset', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?limit=2&offset=0`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('supports combined filters', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/tool-calls?agent_id=${agentId}&tool_name=bash`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { tool_name: string; status: string }[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].tool_name).toBe('bash')
    expect(body.data[0].status).toBe('error')
  })
})
