/**
 * @shackleai/shared — TypeScript interfaces matching DB tables
 */

export interface Company {
  id: string
  name: string
  description: string | null
  status: string
  issue_prefix: string
  issue_counter: number
  budget_monthly_cents: number
  spent_monthly_cents: number
  default_honesty_checklist: string[] | null
  require_approval: boolean
  created_at: Date
  updated_at: Date
}

export interface Agent {
  id: string
  company_id: string
  name: string
  title: string | null
  role: string
  status: string
  reports_to: string | null
  capabilities: string | null
  adapter_type: string
  adapter_config: Record<string, unknown>
  budget_monthly_cents: number
  spent_monthly_cents: number
  last_heartbeat_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface HonestyChecklistItem {
  label: string
  checked: boolean
}

export interface Issue {
  id: string
  company_id: string
  identifier: string
  issue_number: number
  parent_id: string | null
  goal_id: string | null
  project_id: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assignee_agent_id: string | null
  honesty_checklist: HonestyChecklistItem[] | null
  started_at: Date | null
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface Goal {
  id: string
  company_id: string
  parent_id: string | null
  title: string
  description: string | null
  level: string
  status: string
  owner_agent_id: string | null
  created_at: Date
}

export interface Project {
  id: string
  company_id: string
  goal_id: string | null
  lead_agent_id: string | null
  name: string
  description: string | null
  status: string
  target_date: string | null
  created_at: Date
}

export interface IssueComment {
  id: string
  issue_id: string
  author_agent_id: string | null
  content: string
  parent_id: string | null
  is_resolved: boolean
  created_at: Date
}

export interface Policy {
  id: string
  company_id: string
  agent_id: string | null
  name: string
  tool_pattern: string
  action: string
  priority: number
  max_calls_per_hour: number | null
  created_at: Date
}

export interface CostEvent {
  id: string
  company_id: string
  agent_id: string | null
  issue_id: string | null
  provider: string | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cost_cents: number
  occurred_at: Date
}


export interface FinanceEvent {
  id: string
  company_id: string
  event_type: string
  amount_cents: number
  description: string | null
  agent_id: string | null
  provider: string | null
  model: string | null
  created_at: Date
}

export interface FinanceBreakdown {
  key: string
  total_cents: number
  event_count: number
}

export interface FinanceTimelineEntry {
  date: string
  total_cents: number
  event_count: number
}

export interface FinanceTopSpender {
  agent_id: string
  agent_name: string
  total_cents: number
  event_count: number
}

export interface HeartbeatRun {
  id: string
  company_id: string
  agent_id: string
  trigger_type: string
  status: string
  started_at: Date | null
  finished_at: Date | null
  exit_code: number | null
  error: string | null
  usage_json: Record<string, unknown> | null
  session_id_before: string | null
  session_id_after: string | null
  stdout_excerpt: string | null
  created_at: Date
}

export interface ActivityLogEntry {
  id: string
  company_id: string
  entity_type: string
  entity_id: string | null
  actor_type: string
  actor_id: string | null
  action: string
  changes: Record<string, unknown> | null
  created_at: Date
}

export interface AgentApiKey {
  id: string
  agent_id: string
  company_id: string
  key_hash: string
  label: string | null
  status: string
  last_used_at: Date | null
  created_at: Date
}

export interface LicenseKey {
  id: string
  company_id: string
  key_hash: string
  tier: string
  valid_until: Date | null
  last_validated_at: Date | null
  created_at: Date
}

/**
 * Agent communication context — injected into AdapterContext during heartbeat.
 * Enables agents to observe activity, their assigned tasks, and unread comments
 * without requiring an event bus or direct messaging (FREE tier).
 */
export interface AgentCommunicationContext {
  /** Activity log entries since the agent's last heartbeat (max 50). */
  recentActivity: ActivityLogEntry[]
  /** Issues currently checked out by this agent (status = 'in_progress'). */
  assignedTasks: Issue[]
  /** Comments on agent's tasks posted since the agent's last heartbeat. */
  unreadComments: IssueComment[]
}

export interface ToolCall {
  id: string
  heartbeat_run_id: string
  agent_id: string
  company_id: string
  tool_name: string
  tool_input: Record<string, unknown> | null
  tool_output: string | null
  duration_ms: number | null
  status: string
  created_at: Date
}

export interface AgentWorktree {
  id: string
  agent_id: string
  company_id: string
  issue_id: string | null
  repo_path: string
  worktree_path: string
  branch: string
  base_branch: string
  status: string
  created_at: Date
  last_used_at: Date
}

export interface WorktreeInfo {
  path: string
  branch: string
  baseBranch: string
  agentId: string
  companyId: string
  issueId?: string
  status: 'active' | 'stale' | 'merged'
  isDirty: boolean
  commitsAhead: number
  commitsBehind: number
  createdAt: Date
}

export interface WorktreeConfig {
  enabled: boolean
  repoPath: string
  baseBranch?: string
  autoBranch?: boolean
  autoCleanup?: boolean
}

export interface CleanupResult {
  removed: string[]
  stashed: string[]
  skipped: string[]
}

export interface Approval {
  id: string
  company_id: string
  type: string
  payload: Record<string, unknown>
  status: string
  requested_by: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface Secret {
  id: string
  company_id: string
  name: string
  encrypted_value: string
  created_by: string | null
  created_at: Date
  updated_at: Date
}

export interface AgentConfigRevision {
  id: string
  agent_id: string
  revision_number: number
  config_snapshot: Record<string, unknown>
  changed_by: string | null
  change_reason: string | null
  created_at: string
}

export type HeartbeatRunEventType =
  | 'adapter_loaded'
  | 'governance_checked'
  | 'budget_checked'
  | 'context_built'
  | 'adapter_started'
  | 'adapter_finished'
  | 'cost_recorded'
  | 'session_saved'
  | 'error'

export interface HeartbeatRunEvent {
  id: string
  heartbeat_run_id: string
  event_type: HeartbeatRunEventType
  payload: Record<string, unknown> | null
  created_at: string
}

export interface QuotaWindow {
  id: string
  company_id: string
  agent_id: string | null
  provider: string | null
  window_duration: string
  max_requests: number | null
  max_tokens: number | null
  created_at: string
}

export interface QuotaStatus {
  quota: QuotaWindow
  current_requests: number
  current_tokens: number
  exceeded: boolean
}

export interface Label {
  id: string
  company_id: string
  name: string
  color: string
  description: string | null
  created_at: Date
  updated_at: Date
}

export interface IssueLabel {
  issue_id: string
  label_id: string
  created_at: Date
}


// ---------------------------------------------------------------------------
// Assets (company-level file storage)
// ---------------------------------------------------------------------------

export interface Asset {
  id: string
  company_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by: string | null
  created_at: Date
}

// ---------------------------------------------------------------------------
// Issue Attachments & Work Products
// ---------------------------------------------------------------------------

export interface IssueAttachment {
  id: string
  issue_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by_agent_id: string | null
  created_at: Date
}

export interface IssueWorkProduct {
  id: string
  issue_id: string
  title: string
  description: string | null
  type: string
  url: string
  agent_id: string | null
  created_at: Date
}


export interface IssueReadState {
  issue_id: string
  user_or_agent_id: string
  last_read_at: Date
}

export interface InboxItem {
  type: 'unread_issue' | 'pending_approval' | 'new_comment'
  id: string
  title: string
  timestamp: string
  meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface Document {
  id: string
  company_id: string
  title: string
  content: string
  created_by_agent_id: string | null
  created_at: Date
  updated_at: Date
}

export interface DocumentRevision {
  id: string
  document_id: string
  content: string
  revision_number: number
  created_by_agent_id: string | null
  created_at: Date
}

export interface IssueDocument {
  issue_id: string
  document_id: string
  created_at: Date
}

// ---------------------------------------------------------------------------
// Company Templates
// ---------------------------------------------------------------------------

/** An agent definition within a template — no IDs, just configuration. */
export interface TemplateAgent {
  name: string
  title?: string | null
  role: string
  capabilities?: string | null
  adapter_type: string
  adapter_config?: Record<string, unknown>
  budget_monthly_cents?: number
  /** Name of the agent this one reports to (resolved at import time). */
  reports_to?: string | null
}

/** A goal definition within a template. */
export interface TemplateGoal {
  title: string
  description?: string | null
  level: string
  /** Name of the owning agent (resolved at import time). */
  owner_agent_name?: string | null
}

/** A policy definition within a template. */
export interface TemplatePolicy {
  name: string
  tool_pattern: string
  action: string
  priority?: number
  max_calls_per_hour?: number | null
  /** Name of the agent this policy applies to (resolved at import time). null = company-wide. */
  agent_name?: string | null
}

/** A full company template — portable, ID-free description of an org structure. */
export interface CompanyTemplate {
  name: string
  description: string
  version: string
  agents: TemplateAgent[]
  goals?: TemplateGoal[]
  policies?: TemplatePolicy[]
}

/** Metadata returned when listing templates (no full content). */
export interface TemplateSummary {
  slug: string
  name: string
  description: string
  version: string
  agent_count: number
  goal_count: number
  policy_count: number
}

// ---------------------------------------------------------------------------
// Company Export/Import -- full portable company snapshots
// ---------------------------------------------------------------------------

/** A project definition within an export -- no IDs, uses agent/goal names. */
export interface ExportProject {
  name: string
  description?: string | null
  status: string
  target_date?: string | null
  /** Name of the goal this project is linked to (resolved at import time). */
  goal_title?: string | null
  /** Name of the lead agent (resolved at import time). */
  lead_agent_name?: string | null
}

/** An issue definition within an export -- no IDs, uses name-based references. */
export interface ExportIssue {
  title: string
  description?: string | null
  status: string
  priority: string
  /** Name of the assigned agent (resolved at import time). */
  assignee_agent_name?: string | null
  /** Name of the project this issue belongs to (resolved at import time). */
  project_name?: string | null
  /** Title of the goal this issue is linked to (resolved at import time). */
  goal_title?: string | null
  /** Title of the parent issue (resolved at import time). */
  parent_issue_title?: string | null
}

/**
 * A full company export -- portable, ID-free snapshot of all company structure.
 * Extends CompanyTemplate with projects and issues.
 * All UUIDs, timestamps, cost_events, and heartbeat_runs are scrubbed.
 */
export interface CompanyExport extends CompanyTemplate {
  /** Export format identifier. */
  export_version: string
  /** Company metadata. */
  company: {
    name: string
    description?: string | null
    issue_prefix: string
    budget_monthly_cents: number
    default_honesty_checklist?: string[] | null
    require_approval: boolean
  }
  projects: ExportProject[]
  issues: ExportIssue[]
}

/** Result of importing a company export. */
export interface CompanyImportResult {
  company: Company
  agents_created: number
  goals_created: number
  policies_created: number
  projects_created: number
  issues_created: number
}


// ---------------------------------------------------------------------------
// Wakeup Requests
// ---------------------------------------------------------------------------

/** A queued wakeup request for an agent that was busy when triggered. */
export interface WakeupRequest {
  id: string
  agent_id: string
  company_id: string
  trigger_type: string
  reason: string | null
  status: 'pending' | 'processed' | 'expired'
  created_at: string
  processed_at: string | null
}

// ---------------------------------------------------------------------------
// Workspace Operations — immutable audit trail for agent workspace activity
// ---------------------------------------------------------------------------

export interface WorkspaceOperation {
  id: string
  workspace_id: string
  agent_id: string
  operation_type: string
  file_path: string | null
  details: Record<string, unknown>
  created_at: Date
}

// ---------------------------------------------------------------------------
// WebSocket Events — real-time dashboard updates
// ---------------------------------------------------------------------------

/**
 * A WebSocket event sent to connected dashboard clients.
 * All events include companyId so the server can broadcast
 * only to connections belonging to the same company.
 */
export interface WebSocketEvent {
  /** Event type discriminator (e.g. 'heartbeat_start', 'agent_status_change'). */
  type: string
  /** Company scope — used for routing to the correct connections. */
  companyId: string
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string
  /** Event-specific payload. */
  payload: Record<string, unknown>
}

/** Payload for heartbeat_start / heartbeat_end events. */
export interface HeartbeatEventPayload {
  runId: string
  agentId: string
  trigger: string
  status?: string
  exitCode?: number
  durationMs?: number
}

/** Payload for agent_status_change events. */
export interface AgentStatusChangePayload {
  agentId: string
  previousStatus: string
  newStatus: string
}

/** Payload for task_update events. */
export interface TaskUpdatePayload {
  issueId: string
  title: string
  previousStatus?: string
  newStatus: string
  agentId?: string
}

/** Payload for cost_event events. */
export interface CostEventPayload {
  agentId: string
  provider: string
  model: string
  costCents: number
  inputTokens: number
  outputTokens: number
}

