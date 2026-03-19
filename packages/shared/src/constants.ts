/**
 * @shackleai/shared — Enums and constants
 *
 * Uses `as const` objects instead of TypeScript enums
 * for better tree-shaking and runtime use.
 */

export const AgentStatus = {
  Idle: 'idle',
  Active: 'active',
  Paused: 'paused',
  Terminated: 'terminated',
  Error: 'error',
} as const
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus]

export const IssueStatus = {
  Backlog: 'backlog',
  Todo: 'todo',
  InProgress: 'in_progress',
  InReview: 'in_review',
  Done: 'done',
  Cancelled: 'cancelled',
} as const
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus]

export const IssuePriority = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const
export type IssuePriority = (typeof IssuePriority)[keyof typeof IssuePriority]

export const AdapterType = {
  Process: 'process',
  Http: 'http',
  Claude: 'claude',
  Mcp: 'mcp',
  OpenClaw: 'openclaw',
  CrewAI: 'crewai',
  Codex: 'codex',
  Cursor: 'cursor',
  Gemini: 'gemini',
  Kiro: 'kiro',
  OpenCode: 'opencode',
} as const
export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType]

export const TriggerType = {
  Cron: 'cron',
  Manual: 'manual',
  Event: 'event',
  Api: 'api',
  TaskAssigned: 'task_assigned',
  Mentioned: 'mentioned',
  Delegated: 'delegated',
} as const
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType]

export const PolicyAction = {
  Allow: 'allow',
  Deny: 'deny',
  Log: 'log',
} as const
export type PolicyAction = (typeof PolicyAction)[keyof typeof PolicyAction]

export const GoalLevel = {
  Strategic: 'strategic',
  Initiative: 'initiative',
  Project: 'project',
  Task: 'task',
} as const
export type GoalLevel = (typeof GoalLevel)[keyof typeof GoalLevel]

export const HeartbeatRunStatus = {
  Queued: 'queued',
  Running: 'running',
  Success: 'success',
  Failed: 'failed',
  Timeout: 'timeout',
} as const
export type HeartbeatRunStatus =
  (typeof HeartbeatRunStatus)[keyof typeof HeartbeatRunStatus]

export const CompanyStatus = {
  Active: 'active',
  Inactive: 'inactive',
} as const
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus]

export const AgentRole = {
  General: 'general',
  Ceo: 'ceo',
  Manager: 'manager',
  Worker: 'worker',
} as const
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole]

export const GoalStatus = {
  Active: 'active',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const
export type GoalStatus = (typeof GoalStatus)[keyof typeof GoalStatus]

export const ProjectStatus = {
  Active: 'active',
  Completed: 'completed',
  OnHold: 'on_hold',
  Cancelled: 'cancelled',
} as const
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

export const AgentApiKeyStatus = {
  Active: 'active',
  Revoked: 'revoked',
} as const
export type AgentApiKeyStatus =
  (typeof AgentApiKeyStatus)[keyof typeof AgentApiKeyStatus]

export const LicenseTier = {
  Free: 'free',
  Pro: 'pro',
  Teams: 'teams',
  Enterprise: 'enterprise',
} as const
export type LicenseTier = (typeof LicenseTier)[keyof typeof LicenseTier]

export const WorktreeStatus = {
  Active: 'active',
  Stale: 'stale',
  Merged: 'merged',
} as const
export type WorktreeStatus =
  (typeof WorktreeStatus)[keyof typeof WorktreeStatus]

export const WorkProductType = {
  PullRequest: 'pull_request',
  Document: 'document',
  Report: 'report',
  Artifact: 'artifact',
  Deployment: 'deployment',
  Other: 'other',
} as const
export type WorkProductType =
  (typeof WorkProductType)[keyof typeof WorkProductType]

export const FinanceEventType = {
  LlmCall: 'llm_call',
  ToolUse: 'tool_use',
  BudgetAlert: 'budget_alert',
  BudgetReset: 'budget_reset',
  ManualAdjustment: 'manual_adjustment',
} as const
export type FinanceEventType =
  (typeof FinanceEventType)[keyof typeof FinanceEventType]

/** Maximum file size for attachments (10 MB). */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

/** Maximum file size for assets (10 MB). */
export const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024

/** Allowed MIME types for asset uploads. */
export const ALLOWED_ASSET_MIME_TYPES = [
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  // Archives
  'application/zip',
  'application/gzip',
  // Office
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const

export const WorkspaceOperationType = {
  FileRead: 'file_read',
  FileWrite: 'file_write',
  FileDelete: 'file_delete',
  GitCommit: 'git_commit',
  GitPush: 'git_push',
  GitBranch: 'git_branch',
  CommandExec: 'command_exec',
} as const
export type WorkspaceOperationType =
  (typeof WorkspaceOperationType)[keyof typeof WorkspaceOperationType]

/** Free tier limit for concurrent active worktrees per company. */
export const FREE_TIER_MAX_WORKTREES = 5

/** Default max age for worktree cleanup (7 days in ms). */
export const WORKTREE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Minimum git version required for worktree support. */
export const GIT_MIN_VERSION = '2.5.0'

// ---------------------------------------------------------------------------
// WebSocket real-time event types
// ---------------------------------------------------------------------------

export const WebSocketEventType = {
  HeartbeatStart: 'heartbeat_start',
  HeartbeatEnd: 'heartbeat_end',
  AgentStatusChange: 'agent_status_change',
  TaskUpdate: 'task_update',
  CostEvent: 'cost_event',
} as const
export type WebSocketEventType =
  (typeof WebSocketEventType)[keyof typeof WebSocketEventType]
