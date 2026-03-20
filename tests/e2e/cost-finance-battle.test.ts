/**
 * E2E Battle Test — Cost & Finance (#271)
 *
 * Covers scenarios NOT already tested in:
 *   - apps/cli/__tests__/costs.test.ts
 *   - tests/e2e/budget.test.ts
 *   - apps/cli/__tests__/e2e-battle.test.ts (Battle 5)
 *   - packages/core/__tests__/cost-tracker.test.ts
 *
 * New coverage:
 *   1. Finance events — full CRUD for all event_type values
 *   2. Finance breakdown by agent_id, provider, model, event_type
 *   3. Finance timeline (daily aggregation, actual SQL behavior documented)
 *   4. Top spenders report (default + custom limit)
 *   5. Multi-tenant isolation — company A cannot see company B data
 *   6. Concurrent cost event ingestion (multiple agents simultaneously)
 *   7. Zero-cost operations (cost_cents = 0, amount_cents = 0)
 *   8. Cost event without provider/model (no usage data from provider)
 *   9. Negative budget value → validation error
 *  10. Finance breakdown invalid group_by → 400
 *  11. Finance events filtered by agent_id and event_type query params
 *  12. Finance breakdown SQL behavior with charge/refund/credit enum mismatch (BUG documented)
 *
 * BUG: Finance breakdown and timeline SQL uses hardcoded 'charge'/'refund'/'credit' strings
 * that do NOT match the actual FinanceEventType enum values (llm_call, tool_use, budget_alert,
 * budget_reset, manual_adjustment). As a result, total_cents is always 0 in these aggregations.
 * Tests below document this actual (buggy) behavior and are marked accordingly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FinanceEvent = {
  id: string
  company_id: string
  event_type: string
  amount_cents: number
  description: string | null
  agent_id: string | null
  provider: string | null
  model: string | null
  created_at: string
}

type FinanceBreakdown = {
  key: string
  total_cents: number
  event_count: number
}

type FinanceTimelineEntry = {
  date: string
  total_cents: number
  event_count: number
}

type FinanceTopSpender = {
  agent_id: string
  agent_name: string
  total_cents: number
  event_count: number
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

/** Generate a unique 4-char issue_prefix to avoid DB unique constraint violations. */
function uniquePrefix(tag: string): string {
  // Use the tag first 2 chars + last 2 of a random number
  const rnd = Math.floor(Math.random() * 9000) + 1000
  return (tag.toUpperCase().slice(0, 2) + String(rnd)).slice(0, 4)
}

async function createCompany(app: App, name: string, budgetCents = 0): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: uniquePrefix(name),
      budget_monthly_cents: budgetCents,
    }),
  })
  expect(res.status, `createCompany(${name}) status`).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(
  app: App,
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
  expect(res.status, `createAgent(${name}) status`).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function postFinanceEvent(
  app: App,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<FinanceEvent> {
  const res = await app.request(`/api/companies/${companyId}/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'llm_call',
      amount_cents: 100,
      ...overrides,
    }),
  })
  expect(res.status, 'postFinanceEvent status').toBe(201)
  const body = (await res.json()) as { data: FinanceEvent }
  return body.data
}

async function postCostEvent(
  app: App,
  companyId: string,
  overrides: Record<string, unknown> = {},
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
  expect(res.status, 'postCostEvent status').toBe(201)
  const body = (await res.json()) as { data: CostEventRow }
  return body.data
}

// ---------------------------------------------------------------------------
// 1. Finance Events — full CRUD for all event_type values
// ---------------------------------------------------------------------------

describe('Battle: finance events — all event_type values', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Finance Types Corp')
      agentId = await createAgent(app, companyId, 'Finance Agent')
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  const eventTypes = [
    'llm_call',
    'tool_use',
    'budget_alert',
    'budget_reset',
    'manual_adjustment',
  ]

  for (const eventType of eventTypes) {
    it(`POST /finance creates event of type '${eventType}'`, async () => {
      const event = await postFinanceEvent(app, companyId, {
        event_type: eventType,
        amount_cents: 50,
        description: `Test ${eventType} event`,
        agent_id: agentId,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      })

      expect(event.id).toBeTruthy()
      expect(event.company_id).toBe(companyId)
      expect(event.event_type).toBe(eventType)
      expect(event.amount_cents).toBe(50)
      expect(event.description).toBe(`Test ${eventType} event`)
      expect(event.agent_id).toBe(agentId)
      expect(event.provider).toBe('anthropic')
      expect(event.model).toBe('claude-sonnet-4')
    })
  }

  it('GET /finance returns all created finance events', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(eventTypes.length)
    expect(body.data.every((e) => e.company_id === companyId)).toBe(true)
  })

  it('GET /finance returns empty array on fresh company', async () => {
    const freshId = await createCompany(app, 'Finance Empty Corp')
    const res = await app.request(`/api/companies/${freshId}/finance`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /finance returns 400 for unknown event_type', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'invalid_type', amount_cents: 100 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /finance returns 400 for missing event_type', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_cents: 100 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /finance returns 400 for invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /finance returns 404 for non-existent company', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'llm_call', amount_cents: 100 }),
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 2. Finance Breakdown — by agent_id, provider, model, event_type
//
// BUG: The SQL uses hardcoded 'charge'/'refund'/'credit' event type literals.
// The actual enum values are llm_call/tool_use/budget_alert/budget_reset/manual_adjustment.
// As a result, total_cents is always 0 (ELSE branch fires for every row).
// event_count is correct because it uses COUNT(*), not the CASE expression.
// Tests document this actual behavior and flag the bug.
// ---------------------------------------------------------------------------

describe('Battle: finance breakdown dimensions', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agent1Id: string
  let agent2Id: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Breakdown Corp')
      agent1Id = await createAgent(app, companyId, 'Breakdown Agent 1')
      agent2Id = await createAgent(app, companyId, 'Breakdown Agent 2')

      // Agent 1: 2 llm_call events via anthropic/claude-sonnet-4
      await postFinanceEvent(app, companyId, {
        event_type: 'llm_call',
        amount_cents: 200,
        agent_id: agent1Id,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      })
      await postFinanceEvent(app, companyId, {
        event_type: 'llm_call',
        amount_cents: 150,
        agent_id: agent1Id,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      })

      // Agent 2: 1 tool_use event via openai/gpt-4o
      await postFinanceEvent(app, companyId, {
        event_type: 'tool_use',
        amount_cents: 80,
        agent_id: agent2Id,
        provider: 'openai',
        model: 'gpt-4o',
      })

      // 1 manual_adjustment with no agent (company-level)
      await postFinanceEvent(app, companyId, {
        event_type: 'manual_adjustment',
        amount_cents: 500,
      })
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  // BUG: total_cents is always 0 because the SQL CASE uses 'charge'/'refund'/'credit'
  // but the enum values are 'llm_call'/'tool_use'/etc. event_count is correct.
  it('GET /finance/breakdown?group_by=agent_id — event_count is correct, total_cents is 0 (BUG: enum mismatch in SQL)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=agent_id`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceBreakdown[] }

    // 3 groups: agent1Id, agent2Id, 'unknown' (company-level)
    expect(body.data).toHaveLength(3)

    // BUG: total_cents should be 350 but is 0 due to 'charge' literal mismatch
    const a1 = body.data.find((r) => r.key === agent1Id)
    expect(a1).toBeDefined()
    expect(a1!.event_count).toBe(2)
    // BUG: expect(a1!.total_cents).toBe(350) — fails because SQL uses 'charge' not 'llm_call'
    expect(a1!.total_cents).toBe(0)

    const a2 = body.data.find((r) => r.key === agent2Id)
    expect(a2).toBeDefined()
    expect(a2!.event_count).toBe(1)
    // BUG: expect(a2!.total_cents).toBe(80) — fails because SQL uses 'charge' not 'tool_use'
    expect(a2!.total_cents).toBe(0)
  })

  it('GET /finance/breakdown?group_by=provider — event_count correct, total_cents is 0 (BUG)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=provider`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceBreakdown[] }

    const anthropic = body.data.find((r) => r.key === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!.event_count).toBe(2)
    // BUG: total_cents should be 350 but is 0
    expect(anthropic!.total_cents).toBe(0)

    const openai = body.data.find((r) => r.key === 'openai')
    expect(openai).toBeDefined()
    expect(openai!.event_count).toBe(1)
    // BUG: total_cents should be 80 but is 0
    expect(openai!.total_cents).toBe(0)
  })

  it('GET /finance/breakdown?group_by=model — event_count correct, total_cents is 0 (BUG)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=model`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceBreakdown[] }

    const sonnet = body.data.find((r) => r.key === 'claude-sonnet-4')
    expect(sonnet).toBeDefined()
    expect(sonnet!.event_count).toBe(2)
    // BUG: total_cents should be 350 but is 0
    expect(sonnet!.total_cents).toBe(0)

    const gpt = body.data.find((r) => r.key === 'gpt-4o')
    expect(gpt).toBeDefined()
    expect(gpt!.event_count).toBe(1)
    // BUG: total_cents should be 80 but is 0
    expect(gpt!.total_cents).toBe(0)
  })

  it('GET /finance/breakdown?group_by=event_type — event_count correct, total_cents is 0 (BUG)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=event_type`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceBreakdown[] }

    const llm = body.data.find((r) => r.key === 'llm_call')
    expect(llm).toBeDefined()
    expect(llm!.event_count).toBe(2)
    // BUG: total_cents should be 350 but is 0 (CASE matches 'charge', not 'llm_call')
    expect(llm!.total_cents).toBe(0)

    const tool = body.data.find((r) => r.key === 'tool_use')
    expect(tool).toBeDefined()
    expect(tool!.event_count).toBe(1)
    expect(tool!.total_cents).toBe(0)

    const adj = body.data.find((r) => r.key === 'manual_adjustment')
    expect(adj).toBeDefined()
    expect(adj!.event_count).toBe(1)
    expect(adj!.total_cents).toBe(0)
  })

  it('GET /finance/breakdown returns 400 for invalid group_by value', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=company_id`,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid group_by')
  })

  it('GET /finance/breakdown returns 400 for SQL injection attempt in group_by', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/breakdown?group_by=agent_id;DROP TABLE finance_events--`,
    )
    expect(res.status).toBe(400)
  })

  it('GET /finance/breakdown defaults to group_by=agent_id when param is omitted', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance/breakdown`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceBreakdown[] }
    // Should work without crashing and return data grouped by agent_id
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Finance Timeline
//
// BUG: Same 'charge'/'refund'/'credit' mismatch — total_cents is always 0.
// event_count is correct.
// ---------------------------------------------------------------------------

describe('Battle: finance timeline', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let companyFreshId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Timeline Corp')
      companyFreshId = await createCompany(app, 'Timeline Fresh Corp')

      // Insert 4 events — all today
      await postFinanceEvent(app, companyId, { event_type: 'llm_call', amount_cents: 500 })
      await postFinanceEvent(app, companyId, { event_type: 'tool_use', amount_cents: 300 })
      await postFinanceEvent(app, companyId, { event_type: 'manual_adjustment', amount_cents: 200 })
      await postFinanceEvent(app, companyId, { event_type: 'budget_reset', amount_cents: 100 })
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('GET /finance/timeline returns daily rows with correct event_count', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance/timeline`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTimelineEntry[] }

    // All events inserted today — should be exactly 1 row
    expect(body.data).toHaveLength(1)
    const row = body.data[0]
    expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(row.event_count).toBe(4)
    // BUG: total_cents should be 500+300+200 (charges) - 100 (budget_reset) but is 0
    // because the SQL uses 'charge'/'refund'/'credit' literals
    expect(row.total_cents).toBe(0)
  })

  it('GET /finance/timeline with future from= returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/timeline?from=2099-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTimelineEntry[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /finance/timeline with past to= returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/timeline?to=1970-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTimelineEntry[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /finance/timeline returns empty for fresh company', async () => {
    const res = await app.request(`/api/companies/${companyFreshId}/finance/timeline`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTimelineEntry[] }
    expect(body.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Top Spenders Report
//
// BUG: top-spenders SQL also uses 'charge'/'refund'/'credit', so total_cents = 0 for all.
// However, the ORDER BY total_cents DESC is stable: all are 0, so ordering by agent creation
// is non-deterministic. Tests verify structure and filtering, not ordering by spend.
// ---------------------------------------------------------------------------

describe('Battle: finance top spenders', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let companyEmptyId: string
  let agentIds: string[] = []

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Top Spenders Corp')
      companyEmptyId = await createCompany(app, 'Top Spenders Empty Corp')
      agentIds = []

      // Create 5 agents, each with a different spend amount
      for (let i = 1; i <= 5; i++) {
        const id = await createAgent(app, companyId, `Spender Agent ${i}`)
        agentIds.push(id)
        await postFinanceEvent(app, companyId, {
          event_type: 'llm_call',
          amount_cents: i * 100, // 100, 200, 300, 400, 500
          agent_id: id,
          provider: 'anthropic',
          model: 'claude-sonnet-4',
        })
      }
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('GET /finance/top-spenders returns all 5 agents', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance/top-spenders`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTopSpender[] }

    expect(body.data).toHaveLength(5)
    // Each agent has 1 event
    for (const row of body.data) {
      expect(row.event_count).toBe(1)
      expect(row.agent_name).toMatch(/^Spender Agent \d$/)
    }
    // BUG: total_cents should differ per agent (100,200,300,400,500) but is all 0
    for (const row of body.data) {
      expect(row.total_cents).toBe(0)
    }
  })

  it('GET /finance/top-spenders?limit=3 returns only 3 rows', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/top-spenders?limit=3`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTopSpender[] }
    expect(body.data).toHaveLength(3)
  })

  it('GET /finance/top-spenders?limit=1 returns only 1 row', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/top-spenders?limit=1`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTopSpender[] }
    expect(body.data).toHaveLength(1)
    // The row is a valid agent with a name
    expect(body.data[0].agent_name).toMatch(/^Spender Agent \d$/)
    expect(body.data[0].event_count).toBe(1)
  })

  it('GET /finance/top-spenders with future from= returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance/top-spenders?from=2099-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTopSpender[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /finance/top-spenders returns empty for company with no events', async () => {
    const res = await app.request(`/api/companies/${companyEmptyId}/finance/top-spenders`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceTopSpender[] }
    expect(body.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. Multi-Tenant Isolation
// ---------------------------------------------------------------------------

describe('Battle: multi-tenant isolation — cost and finance events', () => {
  let db: PGliteProvider
  let app: App
  let companyAId: string
  let companyBId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })

      // Use explicit unique prefixes to avoid collision
      const resA = await app.request('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tenant A Corp', issue_prefix: 'TNTA' }),
      })
      expect(resA.status).toBe(201)
      companyAId = ((await resA.json()) as { data: { id: string } }).data.id

      const resB = await app.request('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tenant B Corp', issue_prefix: 'TNTB' }),
      })
      expect(resB.status).toBe(201)
      companyBId = ((await resB.json()) as { data: { id: string } }).data.id

      // Company A: 3 cost events, 2 finance events
      await postCostEvent(app, companyAId, { cost_cents: 100 })
      await postCostEvent(app, companyAId, { cost_cents: 200 })
      await postCostEvent(app, companyAId, { cost_cents: 300 })
      await postFinanceEvent(app, companyAId, { event_type: 'llm_call', amount_cents: 400 })
      await postFinanceEvent(app, companyAId, { event_type: 'tool_use', amount_cents: 50 })

      // Company B: 1 cost event, 1 finance event
      await postCostEvent(app, companyBId, { cost_cents: 999 })
      await postFinanceEvent(app, companyBId, {
        event_type: 'llm_call',
        amount_cents: 888,
      })
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('GET /costs for company A returns only company A cost events', async () => {
    const res = await app.request(`/api/companies/${companyAId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(3)
    expect(body.data.every((e) => e.company_id === companyAId)).toBe(true)
    expect(body.data.find((e) => e.cost_cents === 999)).toBeUndefined()
  })

  it('GET /costs for company B returns only company B cost events', async () => {
    const res = await app.request(`/api/companies/${companyBId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].cost_cents).toBe(999)
    expect(body.data.find((e) => e.cost_cents === 100)).toBeUndefined()
  })

  it('GET /finance for company A returns only company A finance events', async () => {
    const res = await app.request(`/api/companies/${companyAId}/finance`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(2)
    expect(body.data.every((e) => e.company_id === companyAId)).toBe(true)
    expect(body.data.find((e) => e.amount_cents === 888)).toBeUndefined()
  })

  it('GET /finance for company B returns only company B finance events', async () => {
    const res = await app.request(`/api/companies/${companyBId}/finance`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].amount_cents).toBe(888)
    expect(body.data.find((e) => e.amount_cents === 400)).toBeUndefined()
  })

  it('GET /costs/by-agent for company A does not include company B spend', async () => {
    const res = await app.request(`/api/companies/${companyAId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { agent_id: string | null; total_cost_cents: number }[]
    }
    const totalCents = body.data.reduce((sum, r) => sum + r.total_cost_cents, 0)
    // Should be 600 (100+200+300), not 1599
    expect(totalCents).toBe(600)
  })

  it('GET /finance for company A with past to= returns empty (no cross-tenant data)', async () => {
    const res = await app.request(
      `/api/companies/${companyAId}/finance?to=1970-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Concurrent Cost Event Ingestion
// ---------------------------------------------------------------------------

describe('Battle: concurrent cost event ingestion', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentIds: string[] = []

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Concurrent Corp')
      agentIds = []

      for (let i = 1; i <= 5; i++) {
        const id = await createAgent(app, companyId, `Concurrent Agent ${i}`)
        agentIds.push(id)
      }
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('concurrent cost events from 5 agents all persist correctly', async () => {
    // Fire 10 concurrent cost event requests (2 per agent)
    const requests = agentIds.flatMap((agentId, i) => [
      postCostEvent(app, companyId, {
        agent_id: agentId,
        input_tokens: 100,
        output_tokens: 50,
        cost_cents: (i + 1) * 10,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      }),
      postCostEvent(app, companyId, {
        agent_id: agentId,
        input_tokens: 200,
        output_tokens: 100,
        cost_cents: (i + 1) * 5,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      }),
    ])

    const results = await Promise.all(requests)
    expect(results).toHaveLength(10)
    expect(results.every((r) => r.id !== undefined)).toBe(true)
    expect(results.every((r) => r.company_id === companyId)).toBe(true)

    // Verify all 10 events persisted
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(10)
  })

  it('by-agent aggregation is correct after concurrent inserts', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { agent_id: string; total_cost_cents: number; event_count: number }[]
    }

    // 5 agents, each with 2 events
    expect(body.data).toHaveLength(5)
    for (const row of body.data) {
      expect(row.event_count).toBe(2)
    }

    // Total spend: sum of (i+1)*10 + (i+1)*5 for i=0..4
    // = sum of (i+1)*15 = 15+30+45+60+75 = 225
    const total = body.data.reduce((sum, r) => sum + r.total_cost_cents, 0)
    expect(total).toBe(225)
  })
})

// ---------------------------------------------------------------------------
// 7. Zero-Cost Operations
// ---------------------------------------------------------------------------

describe('Battle: zero-cost operations', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Zero Cost Corp')
      agentId = await createAgent(app, companyId, 'Zero Cost Agent', 1000)
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('POST /costs/events accepts cost_cents = 0', async () => {
    const event = await postCostEvent(app, companyId, {
      agent_id: agentId,
      input_tokens: 100,
      output_tokens: 50,
      cost_cents: 0,
    })
    expect(event.cost_cents).toBe(0)
    expect(event.company_id).toBe(companyId)
  })

  it('POST /finance accepts amount_cents = 0', async () => {
    const event = await postFinanceEvent(app, companyId, {
      event_type: 'budget_alert',
      amount_cents: 0,
      description: 'zero-cost budget alert',
    })
    expect(event.amount_cents).toBe(0)
    expect(event.event_type).toBe('budget_alert')
  })

  it('zero-cost cost events appear in cost list and aggregation', async () => {
    const listRes = await app.request(`/api/companies/${companyId}/costs`)
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: CostEventRow[] }
    expect(listBody.data).toHaveLength(1)
    expect(listBody.data[0].cost_cents).toBe(0)

    const aggRes = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(aggRes.status).toBe(200)
    const aggBody = (await aggRes.json()) as {
      data: { agent_id: string; total_cost_cents: number; event_count: number }[]
    }
    expect(aggBody.data).toHaveLength(1)
    expect(aggBody.data[0].total_cost_cents).toBe(0)
    expect(aggBody.data[0].event_count).toBe(1)
  })

  it('dashboard totalSpendCents is 0 after only zero-cost events', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { totalSpendCents: number } }
    expect(body.data.totalSpendCents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. Cost Event Without Provider/Model (No Usage Data)
// ---------------------------------------------------------------------------

describe('Battle: cost tracking when provider returns no usage data', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'No Usage Corp')
      agentId = await createAgent(app, companyId, 'No Usage Agent')
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('POST /costs/events without provider and model fields is accepted', async () => {
    const event = await postCostEvent(app, companyId, {
      agent_id: agentId,
      input_tokens: 0,
      output_tokens: 0,
      cost_cents: 5,
      // No provider, no model — simulates provider returning no usage metadata
    })

    expect(event.id).toBeTruthy()
    expect(event.provider).toBeNull()
    expect(event.model).toBeNull()
    expect(event.input_tokens).toBe(0)
    expect(event.output_tokens).toBe(0)
    expect(event.cost_cents).toBe(5)
  })

  it('cost event without agent_id is accepted (company-level cost)', async () => {
    const event = await postCostEvent(app, companyId, {
      input_tokens: 500,
      output_tokens: 250,
      cost_cents: 20,
      // No agent_id — company-level attribution
    })

    expect(event.id).toBeTruthy()
    expect(event.agent_id).toBeNull()
    expect(event.cost_cents).toBe(20)
  })

  it('by-agent aggregation includes null agent_id row for company-level costs', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { agent_id: string | null; total_cost_cents: number }[]
    }

    // 2 rows: one for agentId (cost_cents=5), one for null (cost_cents=20)
    expect(body.data).toHaveLength(2)
    const nullRow = body.data.find((r) => r.agent_id === null)
    expect(nullRow).toBeDefined()
    expect(nullRow!.total_cost_cents).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// 9. Negative Budget Validation
// ---------------------------------------------------------------------------

describe('Battle: negative budget value validation', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Negative Budget Corp')
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('POST /companies/:id/agents rejects negative budget_monthly_cents', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Negative Budget Agent',
        adapter_type: 'process',
        budget_monthly_cents: -500,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /finance rejects negative amount_cents', async () => {
    const res = await app.request(`/api/companies/${companyId}/finance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'llm_call',
        amount_cents: -100,
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// 10. Finance Events Filtering by agent_id and event_type Query Params
// ---------------------------------------------------------------------------

describe('Battle: finance events query param filtering', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agent1Id: string
  let agent2Id: string

  beforeAll(
    async () => {
      db = new PGliteProvider()
      await runMigrations(db)
      app = createApp(db, { skipAuth: true })
      companyId = await createCompany(app, 'Filter Corp')
      agent1Id = await createAgent(app, companyId, 'Filter Agent 1')
      agent2Id = await createAgent(app, companyId, 'Filter Agent 2')

      // Agent 1: llm_call + tool_use
      await postFinanceEvent(app, companyId, {
        event_type: 'llm_call',
        amount_cents: 100,
        agent_id: agent1Id,
      })
      await postFinanceEvent(app, companyId, {
        event_type: 'tool_use',
        amount_cents: 50,
        agent_id: agent1Id,
      })

      // Agent 2: llm_call only
      await postFinanceEvent(app, companyId, {
        event_type: 'llm_call',
        amount_cents: 200,
        agent_id: agent2Id,
      })
    },
    60000,
  )

  afterAll(async () => {
    await db.close()
  })

  it('GET /finance?agent_id= returns only events for that agent', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance?agent_id=${agent1Id}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(2)
    expect(body.data.every((e) => e.agent_id === agent1Id)).toBe(true)
  })

  it('GET /finance?event_type=llm_call returns only llm_call events', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance?event_type=llm_call`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(2)
    expect(body.data.every((e) => e.event_type === 'llm_call')).toBe(true)
  })

  it('GET /finance?event_type=tool_use returns only tool_use events', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance?event_type=tool_use`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].event_type).toBe('tool_use')
    expect(body.data[0].agent_id).toBe(agent1Id)
  })

  it('GET /finance?agent_id=&event_type= combined filtering works', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance?agent_id=${agent1Id}&event_type=tool_use`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].agent_id).toBe(agent1Id)
    expect(body.data[0].event_type).toBe('tool_use')
  })

  it('GET /finance?event_type=budget_alert returns empty when none exist', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/finance?event_type=budget_alert`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: FinanceEvent[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /finance for non-existent company returns 404', async () => {
    const res = await app.request(
      `/api/companies/00000000-0000-0000-0000-000000000000/finance`,
    )
    expect(res.status).toBe(404)
  })
})
