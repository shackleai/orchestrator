/**
 * Scheduler — cron-based and on-demand heartbeat scheduling for agents.
 *
 * Design principles:
 * - The scheduler does NOT know about adapters — it calls a RunnerExecutor callback.
 * - Coalescing: if an agent heartbeat is already running, skip and log.
 * - Uses node-cron for cron scheduling.
 * - All queries are parameterized (no string concatenation).
 * - All queries are scoped to company_id (multi-tenant) where applicable.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { TriggerType } from '@shackleai/shared'
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
   * Returns the RunnerResult from the executor, or null if coalesced/skipped.
   */
  async triggerNow(agentId: string, reason: TriggerType): Promise<RunnerResult | null> {
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
}
