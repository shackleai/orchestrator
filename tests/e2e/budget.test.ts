/**
 * E2E: Budget tracking
 *
 * Tests cost event ingestion and aggregation:
 *   company with budget → agent with budget → cost events → verify aggregation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CostEventRow = {
  id: string
  company_id: string
  agent_id: string | null
  input_tokens: number
  output_tokens: number
  cost_cents: number
  provider: string | null
  model: string | null
}

type CostByAgent = {
  agent_id: string | null
  total_cost_cents: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  name: string,
  budgetCents = 0,
): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: name.toUpperCase().slice(0, 4),
      budget_monthly_cents: budgetCents,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  name: string,
  budgetCents = 0,
): Promise<string> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      adapter_type: 'process',
      budget_monthly_cents: budgetCents,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function postCostEvent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown>,
): Promise<CostEventRow> {
  const res = await app.request(`/api/companies/${companyId}/costs/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_tokens: 100,
      output_tokens: 50,
      cost_cents: 10,
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CostEventRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('E2E: budget tracking', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agent1Id: string
  let agent2Id: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)

    // Company with a $10 monthly budget (1000 cents)
    companyId = await createCompany(app, 'Budget Corp', 1000)

    // Agent1 with a $5 monthly budget (500 cents)
    agent1Id = await createAgent(app, companyId, 'Budget Agent 1', 500)

    // Agent2 with no budget cap
    agent2Id = await createAgent(app, companyId, 'Budget Agent 2', 0)
  })

  afterAll(async () => {
    await db.close()
  })

  it('company is created with budget_monthly_cents: 1000', async () => {
    const res = await app.request(`/api/companies/${companyId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { budget_monthly_cents: number } }
    expect(body.data.budget_monthly_cents).toBe(1000)
  })

  it('agent1 is created with budget_monthly_cents: 500', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agent1Id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { budget_monthly_cents: number } }
    expect(body.data.budget_monthly_cents).toBe(500)
  })

  it('GET /api/companies/:id/costs returns empty array before any events', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('GET /api/companies/:id/costs/by-agent returns empty array before any events', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostByAgent[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('posts cost event for agent1 via POST /api/companies/:id/costs/events', async () => {
    const event = await postCostEvent(app, companyId, {
      agent_id: agent1Id,
      input_tokens: 500,
      output_tokens: 200,
      cost_cents: 75,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    })

    expect(event.id).toBeTruthy()
    expect(event.company_id).toBe(companyId)
    expect(event.agent_id).toBe(agent1Id)
    expect(event.cost_cents).toBe(75)
    expect(event.input_tokens).toBe(500)
    expect(event.output_tokens).toBe(200)
    expect(event.provider).toBe('anthropic')
    expect(event.model).toBe('claude-3-5-sonnet')
  })

  it('posts a second cost event for agent1', async () => {
    await postCostEvent(app, companyId, {
      agent_id: agent1Id,
      input_tokens: 300,
      output_tokens: 100,
      cost_cents: 40,
    })
  })

  it('posts cost event for agent2', async () => {
    await postCostEvent(app, companyId, {
      agent_id: agent2Id,
      input_tokens: 1000,
      output_tokens: 500,
      cost_cents: 120,
    })
  })

  it('GET /api/companies/:id/costs returns all 3 cost events', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(3)
    // Ordered by occurred_at DESC
    expect(body.data.every((e) => e.company_id === companyId)).toBe(true)
  })

  it('GET /api/companies/:id/costs/by-agent shows correct aggregation per agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostByAgent[] }

    // 2 agents with costs
    expect(body.data).toHaveLength(2)

    // Ordered by total_cost_cents DESC
    const topAgent = body.data[0]
    expect(topAgent.agent_id).toBe(agent2Id)
    expect(topAgent.total_cost_cents).toBe(120)
    expect(topAgent.event_count).toBe(1)

    const secondAgent = body.data[1]
    expect(secondAgent.agent_id).toBe(agent1Id)
    // 75 + 40 = 115
    expect(secondAgent.total_cost_cents).toBe(115)
    expect(secondAgent.total_input_tokens).toBe(800) // 500 + 300
    expect(secondAgent.total_output_tokens).toBe(300) // 200 + 100
    expect(secondAgent.event_count).toBe(2)
  })

  it('dashboard totalSpendCents reflects sum of all cost events', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { totalSpendCents: number }
    }
    // 75 + 40 + 120 = 235
    expect(body.data.totalSpendCents).toBe(235)
  })

  it('returns 400 on POST /costs/events with missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Missing input_tokens, output_tokens, cost_cents
      body: JSON.stringify({ agent_id: agent1Id }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 on POST /costs/events with invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /costs supports date range filtering via from/to query params', async () => {
    // All events occurred at "now" so from far future should return empty
    const res = await app.request(
      `/api/companies/${companyId}/costs?from=2099-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(0)
  })
})
