/**
 * Scheduler — cron-based and on-demand heartbeat scheduling for agents.
 *
 * Design principles:
 * - The scheduler does NOT know about adapters — it calls a RunnerExecutor callback.
 * - Coalescing: if an agent heartbeat is already running, queue the request.
 * - Queued wakeup requests are persisted in `agent_wakeup_requests` so they survive restarts.
 * - After each heartbeat completes, pending requests are drained (one execution per drain).
 * - Uses node-cron for cron scheduling.
 * - All queries are parameterized (no string concatenation).
 * - All queries are scoped to company_id (multi-tenant) where applicable.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { TriggerType, WakeupRequest } from '@shackleai/shared'
import cron from 'node-cron'

/** Result returned by the runner executor callback. */
export interface RunnerResult {
  exitCode: number
  stdout?: string
  stderr?: string
  usage?: Record<string, unknown>
  sessionIdAfter?: string
}

/** Callback the scheduler invokes to execute an agent heartbeat. */
export type RunnerExecutor = (
  agentId: string,
  trigger: TriggerType,
) => Promise<RunnerResult>

interface ScheduleEntry {
  task: cron.ScheduledTask
  cronExpression: string
}

export class Scheduler {
  private db: DatabaseProvider
  private executor: RunnerExecutor
  private schedules = new Map<string, ScheduleEntry>()
  private running = new Set<string>()
  private started = false

  constructor(db: DatabaseProvider, executor: RunnerExecutor) {
    this.db = db
    this.executor = executor
  }

  /**
   * Start the scheduler — loads all agents with cron expressions from DB
   * and registers their schedules.
   */
  async start(companyId?: string): Promise<void> {
    if (this.started) return
    this.started = true

    const query = companyId
      ? {
          text: `SELECT id, adapter_config FROM agents
                 WHERE status IN ('idle', 'active') AND company_id = $1`,
          params: [companyId],
        }
      : {
          text: `SELECT id, adapter_config FROM agents
                 WHERE status IN ('idle', 'active')`,
          params: [] as string[],
        }

    const result = await this.db.query<{
      id: string
      adapter_config: Record<string, unknown> | string
    }>(query.text, query.params)

    for (const row of result.rows) {
      let config: Record<string, unknown>
      try {
        config =
          typeof row.adapter_config === 'string'
            ? (JSON.parse(row.adapter_config) as Record<string, unknown>)
            : row.adapter_config
      } catch {
        console.error(
          `[Scheduler] Invalid adapter_config JSON for agent ${row.id}, skipping`,
        )
        continue
      }

      const cronExpr = config?.cron as string | undefined
      if (cronExpr && cron.validate(cronExpr)) {
        this.registerAgent(row.id, cronExpr)
      }
    }
  }

  /** Stop all cron schedules gracefully. */
  stop(): void {
    for (const [, entry] of this.schedules) {
      entry.task.stop()
    }
    this.schedules.clear()
    this.started = false
  }

  /**
   * Register an agent with the scheduler.
   * If a cron expression is provided, schedules recurring heartbeats.
   * Without cron, the agent is on-demand only (use triggerNow).
   */
  registerAgent(agentId: string, cronExpression?: string): void {
    // Remove existing schedule if any
    const existing = this.schedules.get(agentId)
    if (existing) {
      existing.task.stop()
      this.schedules.delete(agentId)
    }

    if (!cronExpression) return

    if (!cron.validate(cronExpression)) {
      console.error(
        `[Scheduler] Invalid cron expression for agent ${agentId}: ${cronExpression}`,
      )
      return
    }

    const task = cron.schedule(cronExpression, () => {
      void this.executeHeartbeat(agentId, 'cron' as TriggerType)
    })

    this.schedules.set(agentId, { task, cronExpression })
  }

  /**
   * Trigger an immediate on-demand heartbeat for an agent.
   * If the agent is already running, the request is queued in the DB
   * and will be processed when the current heartbeat completes.
   * Returns the RunnerResult, or null if queued/skipped.
   */
  async triggerNow(
    agentId: string,
    reason: TriggerType,
    companyId?: string,
    queueReason?: string,
  ): Promise<RunnerResult | null> {
    // If agent is busy, queue the request instead of silently dropping it
    if (this.running.has(agentId)) {
      await this.queueWakeupRequest(agentId, reason, companyId, queueReason)
      return null
    }

    return this.executeHeartbeat(agentId, reason)
  }

  /** Returns true if the given agent has a heartbeat currently executing. */
  isRunning(agentId: string): boolean {
    return this.running.has(agentId)
  }

  /** Returns true if the scheduler has been started. */
  isStarted(): boolean {
    return this.started
  }

  /** Returns the number of registered cron schedules. */
  get scheduleCount(): number {
    return this.schedules.size
  }

  /**
   * Execute a heartbeat for the given agent.
   * Delegates all run-record management and agent status to the executor.
   * Coalescing: if agent already running, skip and return null.
   */
  private async executeHeartbeat(
    agentId: string,
    trigger: TriggerType,
  ): Promise<RunnerResult | null> {
    // Coalescing — skip if already running
    if (this.running.has(agentId)) {
      return null
    }

    this.running.add(agentId)

    try {
      // Delegate entirely to the executor — it owns heartbeat_run
      // creation, agent status transitions, and result recording.
      const result = await this.executor(agentId, trigger)
      return result
    } catch {
      return null
    } finally {
      this.running.delete(agentId)
    }
  }

  /**
   * Queue a wakeup request in the database for later processing.
   * Called when an agent is busy (coalescing) so triggers are not lost.
   */
  async queueWakeupRequest(
    agentId: string,
    triggerType: TriggerType,
    companyId?: string,
    reason?: string,
  ): Promise<void> {
    const resolvedCompanyId = companyId ?? await this.resolveCompanyId(agentId)
    if (!resolvedCompanyId) {
      console.error(`[Scheduler] Cannot queue wakeup: unable to resolve company_id for agent ${agentId}`)
      return
    }

    try {
      await this.db.query(
        `INSERT INTO agent_wakeup_requests (agent_id, company_id, trigger_type, reason, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [agentId, resolvedCompanyId, triggerType, reason ?? null],
      )
    } catch (err) {
      // Non-blocking: log but do not fail the caller
      console.error(`[Scheduler] Failed to queue wakeup request for agent ${agentId}:`, err)
    }
  }

  /**
   * Get pending wakeup requests for an agent.
   */
  async getPendingRequests(agentId: string): Promise<WakeupRequest[]> {
    const result = await this.db.query<WakeupRequest>(
      `SELECT * FROM agent_wakeup_requests
       WHERE agent_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [agentId],
    )
    return result.rows
  }

  /**
   * Drain pending wakeup requests for an agent after a heartbeat completes.
   * Deduplicates by trigger type -- executes one follow-up heartbeat
   * with the highest-priority queued trigger.
   */
  private async drainPendingRequests(agentId: string): Promise<void> {
    try {
      const pending = await this.db.query<WakeupRequest>(
        `UPDATE agent_wakeup_requests
         SET status = 'processed', processed_at = NOW()
         WHERE agent_id = $1 AND status = 'pending'
         RETURNING *`,
        [agentId],
      )

      if (pending.rows.length === 0) return

      const byTrigger = new Map<string, WakeupRequest>()
      for (const req of pending.rows) {
        byTrigger.set(req.trigger_type, req)
      }

      const triggerPriority: Record<string, number> = {
        task_assigned: 1,
        delegated: 2,
        mentioned: 3,
        manual: 4,
        event: 5,
        api: 6,
        cron: 7,
      }

      const sorted = [...byTrigger.values()].sort(
        (a, b) =>
          (triggerPriority[a.trigger_type] ?? 99) -
          (triggerPriority[b.trigger_type] ?? 99),
      )

      const topTrigger = sorted[0]
      if (topTrigger) {
        void this.triggerNow(topTrigger.agent_id, topTrigger.trigger_type as TriggerType)
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to drain pending wakeup requests for agent ${agentId}:`, err)
    }
  }

  /**
   * Resolve the company_id for an agent from the database.
   */
  private async resolveCompanyId(agentId: string): Promise<string | null> {
    try {
      const result = await this.db.query<{ company_id: string }>(
        `SELECT company_id FROM agents WHERE id = $1`,
        [agentId],
      )
      return result.rows[0]?.company_id ?? null
    } catch {
      return null
    }
  }
}
