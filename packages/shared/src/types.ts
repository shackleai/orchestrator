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
