/**
 * @shackleai/core — Core orchestration engine
 */
export const VERSION = '0.1.0'

export { GovernanceEngine } from './governance/index.js'
export type { PolicyCheckResult } from './governance/index.js'

export { QuotaManager } from './quota/index.js'
export type { QuotaCheckResult } from './quota/index.js'

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
export { HeartbeatEventLogger, insertHeartbeatRunEvent, getHeartbeatRunEvents } from './runner/index.js'

export { LicenseManager } from './license.js'
export type { LicenseStatus, ActivationResult } from './license.js'

export { WorktreeManager } from './worktree/index.js'
export { WorkspacePolicyEngine } from './worktree/index.js'
export { WorkspaceOperationLogger } from './worktree/index.js'
export type { LogOperationInput, OperationFilters } from './worktree/index.js'

export { DelegationService, DelegationError, rollUpParentStatus } from './delegation.js'

export { SecretsManager, LogRedactor } from './secrets/index.js'
export type { SecretRow, SecretListItem } from './secrets/index.js'


export { checkHonestyGate } from './honesty-gate.js'
export type { HonestyGateResult } from './honesty-gate.js'


export {
  listTemplates,
  getTemplate,
  importTemplate,
  exportTemplate,
  exportCompany,
  importCompany,
  clearTemplateCache,
} from './templates/index.js'
export type { TemplateImportResult } from './templates/index.js'

export { createStorageProvider, LocalDiskProvider, S3Provider } from './storage/index.js'
export type {
  StorageProvider,
  StorageConfig,
  LocalDiskConfig,
  S3Config,
  UploadResult,
  DownloadResult,
} from './storage/index.js'

export { PluginManager, PluginLoader, PluginValidationError, HookRegistry, validatePlugin } from './plugins/index.js'
export type {
  ShacklePlugin,
  PluginContext,
  PluginStatus,
  PluginRecord,
  PluginInfo,
  HookEvent,
  HookPayload,
  HookHandler,
} from './plugins/index.js'
