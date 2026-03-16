/**
 * HeartbeatExecutor — orchestrates a single agent heartbeat end-to-end.
 *
 * Flow:
 * 1. Create heartbeat_run record (status=queued)
 * 2. Mark agent status=running
 * 3. Check budget (CostTracker.checkBudget) — abort if hard limit
 * 4. Load adapter by agent.adapter_type (AdapterRegistry)
 * 5. Build context (task, session state, env vars)
 * 6. Execute adapter (with timeout via AbortController)
 * 7. Log event to Observatory
 * 8. Record cost if usage reported
 * 9. Save session state
 * 10. Update heartbeat_run (status=succeeded/failed, timing)
 * 11. Mark agent status=idle
 *
 * Error handling: catch adapter errors, mark run as failed, log to observatory.
 * Timeout: if adapter exceeds timeout, force-kill and mark timed_out.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import type {
  TriggerType,
  ActivityLogEntry,
  Issue,
  IssueComment,
} from '@shackleai/shared'
import {
  AgentStatus,
  HeartbeatRunStatus,
} from '@shackleai/shared'
import type { CostTracker } from '../cost-tracker.js'
import type { Observatory } from '../observatory.js'
import type { AdapterRegistry } from '../adapters/index.js'
import type { AdapterContext, AdapterResult } from '../adapters/index.js'
import { getLastSessionState, saveSessionState } from '../adapters/index.js'
import type { RunnerResult } from '../scheduler.js'

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_S = 300

/** Maximum number of recent activity entries to inject into adapter context. */
const MAX_RECENT_ACTIVITY = 50

interface AgentRow {
  id: string
  company_id: string
  adapter_type: string
  adapter_config: Record<string, unknown> | string
  status: string
  last_heartbeat_at: string | null
}

interface TaskRow {
  id: string
  title: string
}

export class HeartbeatExecutor {
  private db: DatabaseProvider
  private costTracker: CostTracker
  private observatory: Observatory
  private adapterRegistry: AdapterRegistry

  constructor(
    db: DatabaseProvider,
    costTracker: CostTracker,
    observatory: Observatory,
    adapterRegistry: AdapterRegistry,
  ) {
    this.db = db
    this.costTracker = costTracker
    this.observatory = observatory
    this.adapterRegistry = adapterRegistry
  }

  /**
   * Execute a full heartbeat for the given agent.
   * Matches the RunnerExecutor type signature from scheduler.ts.
   */
  async execute(agentId: string, trigger: TriggerType): Promise<RunnerResult> {
    const runId = randomUUID()

    // ── Step 0: Load agent ──────────────────────────────────────────
    const agentResult = await this.db.query<AgentRow>(
      `SELECT id, company_id, adapter_type, adapter_config, status, last_heartbeat_at
       FROM agents WHERE id = $1`,
      [agentId],
    )

    if (agentResult.rows.length === 0) {
      return { exitCode: 1, stderr: `Agent not found: ${agentId}` }
    }

    const agent = agentResult.rows[0]
    const companyId = agent.company_id
    const adapterConfig =
      typeof agent.adapter_config === 'string'
        ? (JSON.parse(agent.adapter_config) as Record<string, unknown>)
        : agent.adapter_config

    // ── Step 1: Create heartbeat_run (queued) ───────────────────────
    await this.db.query(
      `INSERT INTO heartbeat_runs (id, company_id, agent_id, trigger_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [runId, companyId, agentId, trigger, HeartbeatRunStatus.Queued],
    )

    // ── Step 2: Mark agent running ──────────────────────────────────
    await this.db.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [AgentStatus.Active, agentId],
    )

    try {
      // ── Step 3: Budget check ────────────────────────────────────────
      const budget = await this.costTracker.checkBudget(companyId, agentId)
      if (!budget.withinBudget) {
        const errMsg = `Budget exceeded (${budget.percentUsed.toFixed(1)}% used)`
        await this.markRunFailed(runId, errMsg)
        await this.markAgentIdle(agentId)

        this.observatory.logEvent({
          company_id: companyId,
          entity_type: 'heartbeat_run',
          entity_id: runId,
          actor_type: 'agent',
          actor_id: agentId,
          action: 'budget_exceeded',
          changes: { trigger, percentUsed: budget.percentUsed },
        })

        return { exitCode: 1, stderr: errMsg }
      }

      // ── Step 4: Load adapter ────────────────────────────────────────
      const adapter = this.adapterRegistry.get(agent.adapter_type)
      if (!adapter) {
        const errMsg = `Unknown adapter type: ${agent.adapter_type}`
        await this.markRunFailed(runId, errMsg)
        await this.markAgentIdle(agentId)
        return { exitCode: 1, stderr: errMsg }
      }

      // ── Step 5: Build context ───────────────────────────────────────
      const sessionState = await getLastSessionState(agentId, this.db)
      const task = await this.getAssignedTask(agentId)

      // Build agent communication context (async awareness)
      const lastHeartbeat = agent.last_heartbeat_at ?? null
      const [recentActivity, assignedTasks, unreadComments] = await Promise.all([
        this.getRecentActivity(companyId, lastHeartbeat),
        this.getAssignedTasks(agentId),
        this.getUnreadComments(agentId, lastHeartbeat),
      ])

      const ctx: AdapterContext = {
        agentId,
        companyId,
        task: task?.title ?? undefined,
        heartbeatRunId: runId,
        adapterConfig,
        env: {},
        sessionState,
        recentActivity,
        assignedTasks,
        unreadComments,
      }

      // Mark run as running
      await this.db.query(
        `UPDATE heartbeat_runs SET status = $1, started_at = NOW(), session_id_before = $2
         WHERE id = $3`,
        [HeartbeatRunStatus.Running, sessionState, runId],
      )

      // ── Step 6: Execute adapter (with timeout) ──────────────────────
      const timeoutS =
        typeof adapterConfig.timeout === 'number'
          ? adapterConfig.timeout
          : DEFAULT_TIMEOUT_S
      const timeoutMs = timeoutS * 1000

      let adapterResult: AdapterResult
      let timedOut = false

      try {
        adapterResult = await this.executeWithTimeout(
          () => adapter.execute(ctx),
          timeoutMs,
        )
      } catch (err) {
        if (err instanceof TimeoutError) {
          timedOut = true
          adapterResult = {
            exitCode: 124,
            stdout: '',
            stderr: `Adapter timed out after ${timeoutS}s`,
          }
        } else {
          throw err
        }
      }

      // ── Step 7: Log event to Observatory ────────────────────────────
      const finalStatus = timedOut
        ? HeartbeatRunStatus.Timeout
        : adapterResult.exitCode === 0
          ? HeartbeatRunStatus.Success
          : HeartbeatRunStatus.Failed

      this.observatory.logEvent({
        company_id: companyId,
        entity_type: 'heartbeat_run',
        entity_id: runId,
        actor_type: 'agent',
        actor_id: agentId,
        action: `heartbeat_${finalStatus}`,
        changes: {
          trigger,
          exitCode: adapterResult.exitCode,
          adapter: agent.adapter_type,
          timedOut,
        },
      })

      // ── Step 8: Record cost if usage reported ───────────────────────
      if (adapterResult.usage) {
        await this.costTracker.recordCost({
          company_id: companyId,
          agent_id: agentId,
          provider: adapterResult.usage.provider,
          model: adapterResult.usage.model,
          input_tokens: adapterResult.usage.inputTokens,
          output_tokens: adapterResult.usage.outputTokens,
          cost_cents: adapterResult.usage.costCents,
        })
      }

      // ── Step 9: Save session state ──────────────────────────────────
      if (adapterResult.sessionState) {
        await saveSessionState(runId, adapterResult.sessionState, this.db)
      }

      // ── Step 10: Update heartbeat_run ───────────────────────────────
      await this.db.query(
        `UPDATE heartbeat_runs
         SET status = $1,
             finished_at = NOW(),
             exit_code = $2,
             stdout_excerpt = $3,
             error = $4,
             usage_json = $5,
             session_id_after = $6
         WHERE id = $7`,
        [
          finalStatus,
          adapterResult.exitCode,
          adapterResult.stdout?.slice(0, 4000) ?? null,
          adapterResult.stderr || null,
          adapterResult.usage ? JSON.stringify(adapterResult.usage) : null,
          adapterResult.sessionState ?? null,
          runId,
        ],
      )

      // ── Step 11: Mark agent idle ────────────────────────────────────
      await this.markAgentIdle(agentId)

      return {
        exitCode: adapterResult.exitCode,
        stdout: adapterResult.stdout,
        stderr: adapterResult.stderr,
        usage: adapterResult.usage
          ? {
              inputTokens: adapterResult.usage.inputTokens,
              outputTokens: adapterResult.usage.outputTokens,
              costCents: adapterResult.usage.costCents,
              model: adapterResult.usage.model,
              provider: adapterResult.usage.provider,
            }
          : undefined,
        sessionIdAfter: adapterResult.sessionState ?? undefined,
      }
    } catch (err) {
      // ── Error handling ──────────────────────────────────────────────
      const errMsg = err instanceof Error ? err.message : String(err)

      this.observatory.logEvent({
        company_id: companyId,
        entity_type: 'heartbeat_run',
        entity_id: runId,
        actor_type: 'agent',
        actor_id: agentId,
        action: 'heartbeat_error',
        changes: { trigger, error: errMsg },
      })

      await this.markRunFailed(runId, errMsg)
      await this.markAgentIdle(agentId)

      return { exitCode: 1, stderr: errMsg }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async markRunFailed(runId: string, error: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE heartbeat_runs
         SET status = $1, finished_at = NOW(), error = $2
         WHERE id = $3`,
        [HeartbeatRunStatus.Failed, error, runId],
      )
    } catch {
      // Best-effort — don't let logging failure mask the real error
    }
  }

  private async markAgentIdle(agentId: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE agents SET status = $1, last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [AgentStatus.Idle, agentId],
      )
    } catch {
      // Best-effort
    }
  }

  private async getAssignedTask(agentId: string): Promise<TaskRow | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT id, title FROM issues
       WHERE assignee_agent_id = $1 AND status = 'in_progress'
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId],
    )
    return result.rows[0] ?? null
  }

  /**
   * Get recent activity log entries for the company since a given timestamp.
   * If no timestamp, returns the most recent entries (max 50).
   */
  private async getRecentActivity(
    companyId: string,
    since: string | null,
  ): Promise<ActivityLogEntry[]> {
    if (since) {
      const result = await this.db.query<ActivityLogEntry>(
        `SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at
         FROM activity_log
         WHERE company_id = $1 AND created_at > $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [companyId, since, MAX_RECENT_ACTIVITY],
      )
      return result.rows
    }

    const result = await this.db.query<ActivityLogEntry>(
      `SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at
       FROM activity_log
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [companyId, MAX_RECENT_ACTIVITY],
    )
    return result.rows
  }

  /**
   * Get all issues currently assigned to this agent with status 'in_progress'.
   */
  private async getAssignedTasks(agentId: string): Promise<Issue[]> {
    const result = await this.db.query<Issue>(
      `SELECT * FROM issues
       WHERE assignee_agent_id = $1 AND status = 'in_progress'
       ORDER BY created_at DESC`,
      [agentId],
    )
    return result.rows
  }

  /**
   * Get comments on agent's assigned tasks posted since the agent's last heartbeat.
   * Excludes comments authored by the agent itself.
   */
  private async getUnreadComments(
    agentId: string,
    since: string | null,
  ): Promise<IssueComment[]> {
    if (since) {
      const result = await this.db.query<IssueComment>(
        `SELECT ic.* FROM issue_comments ic
         JOIN issues i ON ic.issue_id = i.id
         WHERE i.assignee_agent_id = $1
           AND ic.created_at > $2
           AND (ic.author_agent_id IS NULL OR ic.author_agent_id != $1)
         ORDER BY ic.created_at DESC
         LIMIT $3`,
        [agentId, since, MAX_RECENT_ACTIVITY],
      )
      return result.rows
    }

    // No previous heartbeat � return empty (no baseline to compare against)
    return []
  }

  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new TimeoutError(`Timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      fn()
        .then((result) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(result)
          }
        })
        .catch((err: unknown) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(err)
          }
        })
    })
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}
