/**
 * @shackleai/core — Core orchestration engine
 */
export const VERSION = '0.1.0'

export { GovernanceEngine, RateLimiter } from './governance/index.js'
export type { PolicyCheckResult } from './governance/index.js'

export { ContextBuilder } from './context-builder.js'

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

export {
  AdapterRegistry,
  ProcessAdapter,
  HttpAdapter,
  ClaudeAdapter,
  McpAdapter,
  OpenClawAdapter,
  CrewAIAdapter,
} from './adapters/index.js'
export { getLastSessionState, saveSessionState } from './adapters/index.js'
export type {
  AdapterContext,
  AdapterModule,
  AdapterResult,
} from './adapters/index.js'

export { Scheduler } from './scheduler.js'
export type { RunnerExecutor, RunnerResult } from './scheduler.js'

export { HeartbeatExecutor } from './runner/index.js'

export { LicenseManager } from './license.js'
export type { LicenseStatus, ActivationResult } from './license.js'

export { WorktreeManager } from './worktree/index.js'

export { DelegationService, DelegationError, rollUpParentStatus } from './delegation.js'

export { SecretsManager, LogRedactor } from './secrets/index.js'
export type { SecretRow, SecretListItem } from './secrets/index.js'
