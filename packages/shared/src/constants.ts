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
} as const
export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType]

export const TriggerType = {
  Cron: 'cron',
  Manual: 'manual',
  Event: 'event',
  Api: 'api',
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
