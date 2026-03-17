/**
 * Core adapter interfaces — the extensible contract for all adapter types.
 *
 * An AdapterModule knows how to execute a single agent heartbeat and
 * return structured output. Adapters are registered in the AdapterRegistry
 * and selected at runtime based on an agent's `adapter_type` column.
 */

import type {
  ActivityLogEntry,
  Issue,
  IssueComment,
} from '@shackleai/shared'

/** Full context chain from company mission down to the current task. */
export interface GoalAncestry {
  mission: string | null
  project: { name: string; description: string | null } | null
  goal: { name: string; description: string | null } | null
  task: { title: string; description: string | null } | null
}

export interface AdapterContext {
  agentId: string
  companyId: string
  task?: string
  heartbeatRunId: string
  adapterConfig: Record<string, unknown>
  env: Record<string, string>
  sessionState?: string | null

  /** Activity log entries since this agent's last heartbeat (max 50). */
  recentActivity?: ActivityLogEntry[]
  /** Issues currently checked out by this agent (status = 'in_progress'). */
  assignedTasks?: Issue[]
  /** Comments on agent's tasks posted since this agent's last heartbeat. */
  unreadComments?: IssueComment[]

  /** Full ancestry chain: mission → project → goal → task. */
  ancestry?: GoalAncestry
}

export interface AdapterResult {
  exitCode: number
  stdout: string
  stderr: string
  sessionState?: string | null
  usage?: {
    inputTokens: number
    outputTokens: number
    costCents: number
    model: string
    provider: string
  }
}

export interface AdapterModule {
  /** Unique adapter type key (e.g. 'process', 'http', 'claude'). */
  type: string

  /** Human-readable label for display. */
  label: string

  /** Execute a single heartbeat and return structured output. */
  execute(ctx: AdapterContext): Promise<AdapterResult>

  /** Optional: verify that the runtime environment is ready for this adapter. */
  testEnvironment?(): Promise<{ ok: boolean; error?: string }>
}
