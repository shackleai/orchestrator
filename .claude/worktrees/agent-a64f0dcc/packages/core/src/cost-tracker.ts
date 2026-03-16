/**
 * CostTracker — token budget enforcement and cost aggregation.
 *
 * Design principles:
 * - All queries are parameterized — no string concatenation.
 * - All queries are scoped to company_id (multi-tenant).
 * - Budget of 0 means unlimited — always within budget.
 * - Soft alert at 80%, hard stop at 100%.
 */

import type { DatabaseProvider } from '@shackleai/db'

export interface RecordCostInput {
  company_id: string
  agent_id?: string
  issue_id?: string
  provider?: string
  model?: string
  input_tokens: number
  output_tokens: number
  cost_cents: number
}

export interface BudgetStatus {
  withinBudget: boolean
  percentUsed: number
  softAlert: boolean
}

export interface AgentSpend {
  agent_id: string
  agent_name: string
  total_cents: number
}

export interface DailySpend {
  date: string
  total_cents: number
}

export class CostTracker {
  private db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  /**
   * Record a cost event: insert into cost_events AND update
   * spent_monthly_cents on agents (if agent_id provided) and companies.
   */
  async recordCost(event: RecordCostInput): Promise<void> {
    // Insert cost event
    await this.db.query(
      `INSERT INTO cost_events (company_id, agent_id, issue_id, provider, model, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.company_id,
        event.agent_id ?? null,
        event.issue_id ?? null,
        event.provider ?? null,
        event.model ?? null,
        event.input_tokens,
        event.output_tokens,
        event.cost_cents,
      ],
    )

    // Update agent spent if agent_id provided
    if (event.agent_id) {
      await this.db.query(
        `UPDATE agents SET spent_monthly_cents = spent_monthly_cents + $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [event.cost_cents, event.agent_id, event.company_id],
      )
    }

    // Update company spent
    await this.db.query(
      `UPDATE companies SET spent_monthly_cents = spent_monthly_cents + $1, updated_at = NOW()
       WHERE id = $2`,
      [event.cost_cents, event.company_id],
    )
  }

  /**
   * Check whether an agent is within its budget.
   * - Budget of 0 means unlimited (always within budget).
   * - Soft alert at 80% usage.
   * - Hard stop (withinBudget=false) at 100% usage.
   */
  async checkBudget(
    companyId: string,
    agentId: string,
  ): Promise<BudgetStatus> {
    const result = await this.db.query<{
      budget_monthly_cents: number
      spent_monthly_cents: number
    }>(
      `SELECT budget_monthly_cents, spent_monthly_cents FROM agents
       WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )

    if (result.rows.length === 0) {
      return { withinBudget: true, percentUsed: 0, softAlert: false }
    }

    const { budget_monthly_cents, spent_monthly_cents } = result.rows[0]

    // Unlimited budget
    if (budget_monthly_cents === 0) {
      return { withinBudget: true, percentUsed: 0, softAlert: false }
    }

    const percentUsed = (spent_monthly_cents / budget_monthly_cents) * 100
    const softAlert = percentUsed >= 80
    const withinBudget = percentUsed < 100

    return { withinBudget, percentUsed, softAlert }
  }

  /**
   * Get total spend per agent for a company, aggregated from cost_events.
   */
  async getSpendByAgent(companyId: string): Promise<AgentSpend[]> {
    const result = await this.db.query<AgentSpend>(
      `SELECT ce.agent_id, a.name AS agent_name, SUM(ce.cost_cents)::int AS total_cents
       FROM cost_events ce
       JOIN agents a ON a.id = ce.agent_id
       WHERE ce.company_id = $1 AND ce.agent_id IS NOT NULL
       GROUP BY ce.agent_id, a.name
       ORDER BY total_cents DESC`,
      [companyId],
    )

    return result.rows
  }

  /**
   * Get daily spend for a company within a date range.
   */
  async getSpendByPeriod(
    companyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DailySpend[]> {
    const result = await this.db.query<DailySpend>(
      `SELECT occurred_at::date::text AS date, SUM(cost_cents)::int AS total_cents
       FROM cost_events
       WHERE company_id = $1 AND occurred_at >= $2 AND occurred_at < $3
       GROUP BY occurred_at::date
       ORDER BY date ASC`,
      [companyId, startDate.toISOString(), endDate.toISOString()],
    )

    return result.rows
  }

  /**
   * Reset monthly spend counters to 0 for all agents and the company itself.
   */
  async resetMonthlySpend(companyId: string): Promise<void> {
    await this.db.query(
      `UPDATE agents SET spent_monthly_cents = 0, updated_at = NOW()
       WHERE company_id = $1`,
      [companyId],
    )

    await this.db.query(
      `UPDATE companies SET spent_monthly_cents = 0, updated_at = NOW()
       WHERE id = $1`,
      [companyId],
    )
  }
}
