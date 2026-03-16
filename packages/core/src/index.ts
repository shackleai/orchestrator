/**
 * @shackleai/core — Core orchestration engine
 */
export const VERSION = '0.0.0'

export { GovernanceEngine, RateLimiter } from './governance/index.js'
export type { PolicyCheckResult } from './governance/index.js'

export { CostTracker } from './cost-tracker.js'
export type {
  RecordCostInput,
  BudgetStatus,
  AgentSpend,
  DailySpend,
} from './cost-tracker.js'

export { Observatory } from './observatory.js'
export type {
  LogEventInput,
  EventFilters,
  ActivityFilters,
} from './observatory.js'
