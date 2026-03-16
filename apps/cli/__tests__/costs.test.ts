import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AdapterType } from '@shackleai/shared'

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
  name = 'Cost Agent',
) {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, adapter_type: AdapterType.Claude }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createCostEvent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request(`/api/companies/${companyId}/costs/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_tokens: 100,
      output_tokens: 50,
      cost_cents: 10,
      ...overrides,
    }),
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('costs routes', () => {
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

  it('GET /api/companies/:id/costs returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/costs/events creates cost event', async () => {
    const res = await createCostEvent(app, companyId, {
      agent_id: agentId,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      input_tokens: 200,
      output_tokens: 80,
      cost_cents: 25,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        company_id: string
        agent_id: string
        input_tokens: number
        output_tokens: number
        cost_cents: number
        provider: string
        model: string
      }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.agent_id).toBe(agentId)
    expect(body.data.input_tokens).toBe(200)
    expect(body.data.output_tokens).toBe(80)
    expect(body.data.cost_cents).toBe(25)
    expect(body.data.provider).toBe('anthropic')
  })

  it('POST /api/companies/:id/costs/events returns 400 on missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_tokens: 100 }), // missing output_tokens, cost_cents
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/costs/events returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/companies/:id/costs/events returns 404 for non-existent company', async () => {
    const res = await createCostEvent(app, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/costs lists cost events', async () => {
    const newCompanyId = await createCompany(app, 'Costs List Corp')
    await createCostEvent(app, newCompanyId, { input_tokens: 100, output_tokens: 50, cost_cents: 5 })
    await createCostEvent(app, newCompanyId, { input_tokens: 200, output_tokens: 100, cost_cents: 10 })

    const res = await app.request(`/api/companies/${newCompanyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('GET /api/companies/:id/costs/by-agent aggregates costs per agent', async () => {
    const newCompanyId = await createCompany(app, 'By Agent Corp')
    const agent1Id = await createAgent(app, newCompanyId, 'Agent One')
    const agent2Id = await createAgent(app, newCompanyId, 'Agent Two')

    await createCostEvent(app, newCompanyId, {
      agent_id: agent1Id,
      input_tokens: 100,
      output_tokens: 50,
      cost_cents: 10,
    })
    await createCostEvent(app, newCompanyId, {
      agent_id: agent1Id,
      input_tokens: 200,
      output_tokens: 100,
      cost_cents: 20,
    })
    await createCostEvent(app, newCompanyId, {
      agent_id: agent2Id,
      input_tokens: 300,
      output_tokens: 150,
      cost_cents: 30,
    })

    const res = await app.request(`/api/companies/${newCompanyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { agent_id: string; total_cost_cents: number; event_count: number }[]
    }
    expect(body.data).toHaveLength(2)

    const agent1Row = body.data.find((r) => r.agent_id === agent1Id)
    expect(agent1Row).toBeDefined()
    expect(agent1Row?.total_cost_cents).toBe(30)
    expect(agent1Row?.event_count).toBe(2)
  })
})
