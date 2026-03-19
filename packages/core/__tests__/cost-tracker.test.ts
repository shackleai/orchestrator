import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { CostTracker } from '../src/cost-tracker.js'

let db: PGliteProvider
let tracker: CostTracker

// Fixed UUIDs for test data
const COMPANY_ID = '00000000-0000-4000-a000-000000000001'
const AGENT_A_ID = '00000000-0000-4000-a000-000000000010'
const AGENT_B_ID = '00000000-0000-4000-a000-000000000011'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Budget Co', 'active', 'BUD', 0, 10000, 0],
  )

  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [AGENT_A_ID, COMPANY_ID, 'coder-bot', 'claude', 5000, 0],
  )

  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [AGENT_B_ID, COMPANY_ID, 'reviewer-bot', 'claude', 0, 0],
  )
}

/** Insert a cost_event with an explicit occurred_at timestamp. */
async function insertCostEvent(
  provider: DatabaseProvider,
  agentId: string,
  costCents: number,
  occurredAt?: Date,
): Promise<void> {
  const ts = occurredAt ?? new Date()
  await provider.query(
    `INSERT INTO cost_events (company_id, agent_id, provider, model, input_tokens, output_tokens, cost_cents, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      COMPANY_ID,
      agentId,
      'anthropic',
      'claude-opus-4',
      100,
      50,
      costCents,
      ts.toISOString(),
    ],
  )
}

beforeAll(async () => {
  db = new PGliteProvider() // in-memory
  await runMigrations(db)
  await seedTestData(db)
  tracker = new CostTracker(db)
})

afterAll(async () => {
  await db.close()
})

describe('CostTracker', () => {
  describe('recordCost', () => {
    it('inserts a cost event and updates spent counters', async () => {
      await tracker.recordCost({
        company_id: COMPANY_ID,
        agent_id: AGENT_A_ID,
        provider: 'anthropic',
        model: 'claude-opus-4',
        input_tokens: 1000,
        output_tokens: 500,
        cost_cents: 150,
      })

      // Verify cost_events row
      const events = await db.query<{ cost_cents: number; provider: string }>(
        'SELECT cost_cents, provider FROM cost_events WHERE company_id = $1',
        [COMPANY_ID],
      )
      expect(events.rows).toHaveLength(1)
      expect(events.rows[0].cost_cents).toBe(150)
      expect(events.rows[0].provider).toBe('anthropic')

      // Verify agent spent updated
      const agent = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM agents WHERE id = $1',
        [AGENT_A_ID],
      )
      expect(agent.rows[0].spent_monthly_cents).toBe(150)

      // Verify company spent updated
      const company = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM companies WHERE id = $1',
        [COMPANY_ID],
      )
      expect(company.rows[0].spent_monthly_cents).toBe(150)
    })

    it('records cost without agent_id (company-level only)', async () => {
      await tracker.recordCost({
        company_id: COMPANY_ID,
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 200,
        output_tokens: 100,
        cost_cents: 50,
      })

      // Company spent should increase, but no agent update
      const company = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM companies WHERE id = $1',
        [COMPANY_ID],
      )
      // 150 from previous test + 50 = 200
      expect(company.rows[0].spent_monthly_cents).toBe(200)

      // Agent A spent should stay at 150
      const agent = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM agents WHERE id = $1',
        [AGENT_A_ID],
      )
      expect(agent.rows[0].spent_monthly_cents).toBe(150)
    })
  })

  describe('checkBudget', () => {
    it('returns correct percentUsed from cost_events', async () => {
      // Agent A: budget 5000, cost_events for this month = 150 = 3%
      const status = await tracker.checkBudget(COMPANY_ID, AGENT_A_ID)
      expect(status.withinBudget).toBe(true)
      expect(status.percentUsed).toBe(3)
      expect(status.softAlert).toBe(false)
    })

    it('triggers soft alert at 80%', async () => {
      // Push agent A to 80%: budget=5000, need total=4000, already have 150 => add 3850
      await insertCostEvent(db, AGENT_A_ID, 3850)

      const status = await tracker.checkBudget(COMPANY_ID, AGENT_A_ID)
      expect(status.withinBudget).toBe(true)
      expect(status.percentUsed).toBe(80)
      expect(status.softAlert).toBe(true)
    })

    it('returns hard stop at 100%', async () => {
      // Need total=5000, currently at 4000 => add 1000
      await insertCostEvent(db, AGENT_A_ID, 1000)

      const status = await tracker.checkBudget(COMPANY_ID, AGENT_A_ID)
      expect(status.withinBudget).toBe(false)
      expect(status.percentUsed).toBe(100)
      expect(status.softAlert).toBe(true)
    })

    it('returns hard stop when over 100%', async () => {
      // Need total=6000, currently at 5000 => add 1000
      await insertCostEvent(db, AGENT_A_ID, 1000)

      const status = await tracker.checkBudget(COMPANY_ID, AGENT_A_ID)
      expect(status.withinBudget).toBe(false)
      expect(status.percentUsed).toBe(120)
      expect(status.softAlert).toBe(true)
    })

    it('returns unlimited budget (budget=0) always within budget', async () => {
      // Agent B has budget_monthly_cents=0
      const status = await tracker.checkBudget(COMPANY_ID, AGENT_B_ID)
      expect(status.withinBudget).toBe(true)
      expect(status.percentUsed).toBe(0)
      expect(status.softAlert).toBe(false)
    })

    it('returns safe defaults for unknown agent', async () => {
      const status = await tracker.checkBudget(
        COMPANY_ID,
        '00000000-0000-4000-a000-999999999999',
      )
      expect(status.withinBudget).toBe(true)
      expect(status.percentUsed).toBe(0)
      expect(status.softAlert).toBe(false)
    })

    it('ignores cost_events from previous months (budget auto-resets)', async () => {
      // Create a fresh agent with a known budget
      const AGENT_C_ID = '00000000-0000-4000-a000-000000000012'
      await db.query(
        `INSERT INTO agents (id, company_id, name, adapter_type, budget_monthly_cents, spent_monthly_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [AGENT_C_ID, COMPANY_ID, 'fresh-bot', 'claude', 1000, 0],
      )

      // Insert a cost event from last month
      const lastMonth = new Date()
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1)
      lastMonth.setUTCDate(15)
      await insertCostEvent(db, AGENT_C_ID, 900, lastMonth)

      // Insert a small cost event this month
      await insertCostEvent(db, AGENT_C_ID, 50)

      // Budget check should only see 50 cents (this month), not 950
      const status = await tracker.checkBudget(COMPANY_ID, AGENT_C_ID)
      expect(status.withinBudget).toBe(true)
      expect(status.percentUsed).toBe(5) // 50/1000 = 5%
      expect(status.softAlert).toBe(false)
    })
  })

  describe('getSpendByAgent', () => {
    it('returns aggregated spend per agent', async () => {
      // Record a cost for agent B so both agents have spend
      await tracker.recordCost({
        company_id: COMPANY_ID,
        agent_id: AGENT_B_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input_tokens: 300,
        output_tokens: 100,
        cost_cents: 75,
      })

      const spend = await tracker.getSpendByAgent(COMPANY_ID)
      expect(spend.length).toBeGreaterThanOrEqual(2)

      const agentA = spend.find((s) => s.agent_id === AGENT_A_ID)
      const agentB = spend.find((s) => s.agent_id === AGENT_B_ID)

      expect(agentA).toBeDefined()
      expect(agentA!.agent_name).toBe('coder-bot')

      expect(agentB).toBeDefined()
      expect(agentB!.agent_name).toBe('reviewer-bot')
    })
  })

  describe('getSpendByPeriod', () => {
    it('returns daily aggregated spend', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const daily = await tracker.getSpendByPeriod(
        COMPANY_ID,
        yesterday,
        tomorrow,
      )
      expect(daily.length).toBeGreaterThanOrEqual(1)
      expect(daily[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(daily[0].total_cents).toBeGreaterThan(0)
    })
  })

  describe('resetMonthlySpend', () => {
    it('zeroes spent_monthly_cents on all agents and company', async () => {
      // Verify there's nonzero spend first
      const beforeCompany = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM companies WHERE id = $1',
        [COMPANY_ID],
      )
      expect(beforeCompany.rows[0].spent_monthly_cents).toBeGreaterThan(0)

      await tracker.resetMonthlySpend(COMPANY_ID)

      // Company should be zeroed
      const afterCompany = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM companies WHERE id = $1',
        [COMPANY_ID],
      )
      expect(afterCompany.rows[0].spent_monthly_cents).toBe(0)

      // All agents should be zeroed
      const agents = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM agents WHERE company_id = $1',
        [COMPANY_ID],
      )
      for (const agent of agents.rows) {
        expect(agent.spent_monthly_cents).toBe(0)
      }
    })
  })
})
