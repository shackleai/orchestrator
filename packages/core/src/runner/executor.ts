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
  WebSocketEventType,
} from '@shackleai/shared'
import {
  AgentStatus,
  HeartbeatRunStatus,
} from '@shackleai/shared'
import type { CostTracker } from '../cost-tracker.js'
import type { Observatory } from '../observatory.js'
import { ContextBuilder } from '../context-builder.js'
import type { AdapterRegistry } from '../adapters/index.js'
import type { AdapterContext, AdapterModule, AdapterResult, GoalAncestry } from '../adapters/index.js'
import { getLastSessionState, saveSessionState } from '../adapters/index.js'
import type { RunnerResult } from '../scheduler.js'
import type { GovernanceEngine } from '../governance/index.js'
import { SecretsManager } from '../secrets/index.js'
import { LogRedactor } from '../secrets/index.js'
import { HeartbeatEventLogger } from './event-logger.js'
import type { QuotaManager } from '../quota/index.js'
import { checkHonestyGate } from '../honesty-gate.js'

/**
 * Callback type for broadcasting WebSocket events from the executor.
 * Decoupled from WebSocketManager to avoid circular imports between core and cli.
 */
export type RealtimeBroadcast = (
  companyId: string,
  type: WebSocketEventType,
  payload: Record<string, unknown>,
) => void

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
  description: string | null
  goal_id: string | null
  project_id: string | null
}

interface GoalRow {
  name: string
  description: string | null
}

interface ProjectRow {
  name: string
  description: string | null
}

interface CompanyMissionRow {
  description: string | null
}

export class HeartbeatExecutor {
  private db: DatabaseProvider
  private costTracker: CostTracker
  private observatory: Observatory
  private adapterRegistry: AdapterRegistry
  private contextBuilder: ContextBuilder
  private governance: GovernanceEngine | null
  private secretsManager: SecretsManager
  private logRedactor: LogRedactor
  private quotaManager: QuotaManager | null
  private broadcast: RealtimeBroadcast | null

  constructor(
    db: DatabaseProvider,
    costTracker: CostTracker,
    observatory: Observatory,
    adapterRegistry: AdapterRegistry,
    governance?: GovernanceEngine,
    quotaManager?: QuotaManager,
    broadcast?: RealtimeBroadcast,
  ) {
    this.db = db
    this.costTracker = costTracker
    this.observatory = observatory
    this.adapterRegistry = adapterRegistry
    this.contextBuilder = new ContextBuilder(db)
    this.governance = governance ?? null
    this.secretsManager = new SecretsManager(db)
    this.logRedactor = new LogRedactor()
    this.quotaManager = quotaManager ?? null
    this.broadcast = broadcast ?? null
  }

  /**
   * Set the realtime broadcast callback after construction.
   * Useful when the WebSocket manager is created after the executor.
   */
  setBroadcast(fn: RealtimeBroadcast): void {
    this.broadcast = fn
  }

  /**
   * Execute a full heartbeat for the given agent.
   * Matches the RunnerExecutor type signature from scheduler.ts.
   */
  async execute(agentId: string, trigger: TriggerType): Promise<RunnerResult> {
    const runId = randomUUID()
    const events = new HeartbeatEventLogger(this.db, runId)

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
    let adapterConfig: Record<string, unknown>
    try {
      adapterConfig =
        typeof agent.adapter_config === 'string'
          ? (JSON.parse(agent.adapter_config) as Record<string, unknown>)
          : agent.adapter_config
    } catch {
      const errMsg = `Invalid adapter_config JSON for agent ${agentId}`
      await this.markRunFailed(runId, errMsg)
      return { exitCode: 1, stderr: errMsg }
    }

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

    // Broadcast: heartbeat started + agent status change
    this.emitWs(companyId, 'heartbeat_start', { runId, agentId, trigger })
    this.emitWs(companyId, 'agent_status_change', { agentId, status: AgentStatus.Active })

    try {
      // ── Step 3: Budget check ────────────────────────────────────────
      const budget = await this.costTracker.checkBudget(companyId, agentId)

      events.emit('budget_checked', {
        withinBudget: budget.withinBudget,
        percentUsed: budget.percentUsed,
      })

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

        events.emit('error', { message: errMsg })

        return { exitCode: 1, stderr: errMsg }
      }

      // -- Step 3b: Quota check -----------------------------------------------
      if (this.quotaManager) {
        const quotaResult = await this.quotaManager.checkQuota(companyId, agentId)
        if (!quotaResult.allowed) {
          const errMsg = `Quota exceeded: ${quotaResult.reason}`
          await this.markRunFailed(runId, errMsg)
          await this.markAgentIdle(agentId)

          this.observatory.logEvent({
            company_id: companyId,
            entity_type: 'heartbeat_run',
            entity_id: runId,
            actor_type: 'agent',
            actor_id: agentId,
            action: 'quota_exceeded',
            changes: {
              trigger,
              quotaId: quotaResult.quotaId ?? null,
              reason: quotaResult.reason,
            },
          })

          return { exitCode: 1, stderr: errMsg }
        }
      }

      // ── Step 4: Load adapter ────────────────────────────────────────
      const adapter = this.adapterRegistry.get(agent.adapter_type)
      if (!adapter) {
        const errMsg = `Unknown adapter type: ${agent.adapter_type}`
        await this.markRunFailed(runId, errMsg)
        await this.markAgentIdle(agentId)
        events.emit('error', { message: errMsg })
        return { exitCode: 1, stderr: errMsg }
      }

      events.emit('adapter_loaded', { adapterType: agent.adapter_type })

      // Step 4b: Governance check
      if (this.governance) {
        const policyResult = await this.governance.checkPolicy(companyId, agentId, agent.adapter_type)

        events.emit('governance_checked', {
          allowed: policyResult.allowed,
          policyId: policyResult.policyId ?? null,
          reason: policyResult.reason ?? null,
        })

        if (!policyResult.allowed) {
          const errMsg = `Governance violation: ${policyResult.reason}`
          await this.markRunFailed(runId, errMsg)
          await this.markAgentIdle(agentId)

          this.observatory.logEvent({
            company_id: companyId,
            entity_type: 'heartbeat_run',
            entity_id: runId,
            actor_type: 'agent',
            actor_id: agentId,
            action: 'governance_violation',
            changes: { trigger, adapter: agent.adapter_type, policyId: policyResult.policyId ?? null, reason: policyResult.reason },
          })

          events.emit('error', { message: errMsg })
          return { exitCode: 1, stderr: errMsg }
        }
      }

      // ── Step 5: Build context ───────────────────────────────────────
      const sessionState = await getLastSessionState(agentId, this.db)
      const task = await this.getAssignedTask(agentId, companyId)

      const lastHeartbeat = agent.last_heartbeat_at ?? null
      const [recentActivity, assignedTasks, unreadComments, ancestry, delegationCtx, systemContext] =
        await Promise.all([
          this.getRecentActivity(companyId, lastHeartbeat),
          this.getAssignedTasks(agentId),
          this.getUnreadComments(agentId, lastHeartbeat),
          this.resolveAncestry(companyId, task),
          this.getDelegationContext(agentId, task),
          this.contextBuilder.build(agentId, companyId),
        ])

      let secretEnv: Record<string, string> = {}
      try {
        secretEnv = await this.secretsManager.getAllDecrypted(companyId)
        const secretValues = Object.values(secretEnv)
        this.logRedactor.addSecrets(secretValues)
      } catch {
        // Non-fatal
      }

      const ctx: AdapterContext = {
        agentId, companyId,
        task: task?.title ?? undefined,
        heartbeatRunId: runId,
        adapterConfig,
        env: { ...secretEnv },
        sessionState, recentActivity, assignedTasks, unreadComments, ancestry,
        delegatedBy: delegationCtx?.delegatedBy,
        subTasks: delegationCtx?.subTasks,
        systemContext,
      }

      events.emit('context_built', {
        hasTask: !!task, hasSessionState: !!sessionState,
        recentActivityCount: recentActivity.length, unreadCommentsCount: unreadComments.length,
      })

      await this.db.query(
        `UPDATE heartbeat_runs SET status = $1, started_at = NOW(), session_id_before = $2 WHERE id = $3`,
        [HeartbeatRunStatus.Running, sessionState, runId],
      )

      // ── Step 6: Execute adapter (with timeout) ──────────────────────
      const timeoutS = typeof adapterConfig.timeout === 'number' ? adapterConfig.timeout : DEFAULT_TIMEOUT_S
      const timeoutMs = timeoutS * 1000

      events.emit('adapter_started', { adapterType: agent.adapter_type, timeoutS })

      let adapterResult: AdapterResult
      let timedOut = false

      try {
        adapterResult = await this.executeWithTimeout(() => adapter.execute(ctx), timeoutMs, adapter)
      } catch (err) {
        if (err instanceof TimeoutError) {
          timedOut = true
          adapterResult = { exitCode: 124, stdout: '', stderr: `Adapter timed out after ${timeoutS}s` }
        } else {
          throw err
        }
      }

      if (adapterResult.stdout) {
        adapterResult = { ...adapterResult, stdout: this.logRedactor.redact(adapterResult.stdout) }
      }
      if (adapterResult.stderr) {
        adapterResult = { ...adapterResult, stderr: this.logRedactor.redact(adapterResult.stderr) }
      }

      events.emit('adapter_finished', { exitCode: adapterResult.exitCode, timedOut, adapterType: agent.adapter_type })

      // ── Step 7: Log event to Observatory ────────────────────────────
      const finalStatus = timedOut
        ? HeartbeatRunStatus.Timeout
        : adapterResult.exitCode === 0 ? HeartbeatRunStatus.Success : HeartbeatRunStatus.Failed

      this.observatory.logEvent({
        company_id: companyId, entity_type: 'heartbeat_run', entity_id: runId,
        actor_type: 'agent', actor_id: agentId, action: `heartbeat_${finalStatus}`,
        changes: { trigger, exitCode: adapterResult.exitCode, adapter: agent.adapter_type, timedOut },
      })

      // ── Step 8: Record cost if usage reported ───────────────────────
      if (adapterResult.usage) {
        await this.costTracker.recordCost({
          company_id: companyId, agent_id: agentId,
          provider: adapterResult.usage.provider, model: adapterResult.usage.model,
          input_tokens: adapterResult.usage.inputTokens, output_tokens: adapterResult.usage.outputTokens,
          cost_cents: adapterResult.usage.costCents,
        })

        events.emit('cost_recorded', {
          provider: adapterResult.usage.provider, model: adapterResult.usage.model,
          costCents: adapterResult.usage.costCents,
        })

        this.emitWs(companyId, 'cost_event', {
          runId, agentId,
          provider: adapterResult.usage.provider, model: adapterResult.usage.model,
          inputTokens: adapterResult.usage.inputTokens, outputTokens: adapterResult.usage.outputTokens,
          costCents: adapterResult.usage.costCents,
        })
      }

      // ── Step 9: Save session state ──────────────────────────────────
      if (adapterResult.sessionState) {
        await saveSessionState(runId, adapterResult.sessionState, this.db)
        events.emit('session_saved', { sessionState: adapterResult.sessionState })
      }

      // ── Step 9b: Record tool calls ─────────────────────────────────
      if (adapterResult.toolCalls && adapterResult.toolCalls.length > 0) {
        await this.recordToolCalls(runId, agentId, companyId, adapterResult.toolCalls)

        for (const tc of adapterResult.toolCalls) {
          this.emitWs(companyId, 'tool_call', {
            runId, agentId, toolName: tc.toolName,
            status: tc.status ?? 'success', durationMs: tc.durationMs ?? null,
          })
        }
      }

      // ── Step 9c: Update task status if agent reported one ──────────
      if (adapterResult.taskStatus && task) {
        try {
          if (adapterResult.taskStatus === 'done') {
            const gate = await checkHonestyGate(this.db, task.id, companyId)
            if (!gate.passed) {
              this.observatory.logEvent({
                company_id: companyId, entity_type: 'issue', entity_id: task.id,
                actor_type: 'agent', actor_id: agentId, action: 'honesty_gate_blocked',
                changes: { title: task.title, reason: gate.reason, uncheckedItems: gate.uncheckedItems ?? [] },
              })
              events.emit('error', { message: `Honesty gate blocked task completion: ${gate.reason}` })
            } else {
              await this.db.query(`UPDATE issues SET status = $1, updated_at = NOW() WHERE id = $2`, [adapterResult.taskStatus, task.id])
              this.observatory.logEvent({
                company_id: companyId, entity_type: 'issue', entity_id: task.id,
                actor_type: 'agent', actor_id: agentId, action: `task_${adapterResult.taskStatus}`,
                changes: { title: task.title, newStatus: adapterResult.taskStatus },
              })
              this.emitWs(companyId, 'task_update', { issueId: task.id, title: task.title, newStatus: adapterResult.taskStatus, agentId })
            }
          } else {
            await this.db.query(`UPDATE issues SET status = $1, updated_at = NOW() WHERE id = $2`, [adapterResult.taskStatus, task.id])
            this.observatory.logEvent({
              company_id: companyId, entity_type: 'issue', entity_id: task.id,
              actor_type: 'agent', actor_id: agentId, action: `task_${adapterResult.taskStatus}`,
              changes: { title: task.title, newStatus: adapterResult.taskStatus },
            })
            this.emitWs(companyId, 'task_update', { issueId: task.id, title: task.title, newStatus: adapterResult.taskStatus, agentId })
          }
        } catch {
          // Best-effort
        }
      }

      // ── Step 10: Update heartbeat_run ───────────────────────────────
      await this.db.query(
        `UPDATE heartbeat_runs SET status = $1, finished_at = NOW(), exit_code = $2,
             stdout_excerpt = $3, error = $4, usage_json = $5, session_id_after = $6
         WHERE id = $7`,
        [finalStatus, adapterResult.exitCode, adapterResult.stdout?.slice(0, 4000) ?? null,
         adapterResult.stderr || null, adapterResult.usage ? JSON.stringify(adapterResult.usage) : null,
         adapterResult.sessionState ?? null, runId],
      )

      // ── Step 11: Mark agent idle ────────────────────────────────────
      await this.markAgentIdle(agentId)

      this.emitWs(companyId, 'heartbeat_end', { runId, agentId, status: finalStatus, exitCode: adapterResult.exitCode, timedOut })
      this.emitWs(companyId, 'agent_status_change', { agentId, status: AgentStatus.Idle })

      return {
        exitCode: adapterResult.exitCode, stdout: adapterResult.stdout, stderr: adapterResult.stderr,
        usage: adapterResult.usage ? {
          inputTokens: adapterResult.usage.inputTokens, outputTokens: adapterResult.usage.outputTokens,
          costCents: adapterResult.usage.costCents, model: adapterResult.usage.model, provider: adapterResult.usage.provider,
        } : undefined,
        sessionIdAfter: adapterResult.sessionState ?? undefined,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this.observatory.logEvent({
        company_id: companyId, entity_type: 'heartbeat_run', entity_id: runId,
        actor_type: 'agent', actor_id: agentId, action: 'heartbeat_error',
        changes: { trigger, error: errMsg },
      })
      events.emit('error', { message: errMsg })
      await this.markRunFailed(runId, errMsg)
      await this.markAgentIdle(agentId)
      this.emitWs(companyId, 'heartbeat_end', { runId, agentId, status: HeartbeatRunStatus.Failed, error: errMsg })
      this.emitWs(companyId, 'agent_status_change', { agentId, status: AgentStatus.Idle })
      return { exitCode: 1, stderr: errMsg }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private emitWs(companyId: string, type: WebSocketEventType, payload: Record<string, unknown>): void {
    if (!this.broadcast) return
    try { this.broadcast(companyId, type, payload) } catch { /* best-effort */ }
  }

  private async recordToolCalls(runId: string, agentId: string, companyId: string, toolCalls: NonNullable<AdapterResult['toolCalls']>): Promise<void> {
    try {
      const valueClauses: string[] = []
      const params: unknown[] = []
      let idx = 1
      for (const tc of toolCalls) {
        valueClauses.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
        params.push(runId, agentId, companyId, tc.toolName, tc.toolInput ? JSON.stringify(tc.toolInput) : null, tc.toolOutput ?? null, tc.durationMs ?? null, tc.status ?? 'success')
        idx += 8
      }
      await this.db.query(
        `INSERT INTO tool_calls (heartbeat_run_id, agent_id, company_id, tool_name, tool_input, tool_output, duration_ms, status) VALUES ${valueClauses.join(', ')}`,
        params,
      )
    } catch { /* best-effort */ }
  }

  private async markRunFailed(runId: string, error: string): Promise<void> {
    try {
      await this.db.query(`UPDATE heartbeat_runs SET status = $1, finished_at = NOW(), error = $2 WHERE id = $3`, [HeartbeatRunStatus.Failed, error, runId])
    } catch { /* best-effort */ }
  }

  private async markAgentIdle(agentId: string): Promise<void> {
    try {
      await this.db.query(`UPDATE agents SET status = $1, last_heartbeat_at = NOW(), updated_at = NOW() WHERE id = $2`, [AgentStatus.Idle, agentId])
    } catch { /* best-effort */ }
  }

  private async getAssignedTask(agentId: string, companyId: string): Promise<TaskRow | null> {
    const inProgress = await this.db.query<TaskRow>(
      `SELECT id, title, description, goal_id, project_id FROM issues WHERE assignee_agent_id = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`,
      [agentId],
    )
    if (inProgress.rows.length > 0) return inProgress.rows[0]

    const checkout = await this.db.query<TaskRow>(
      `UPDATE issues SET status = 'in_progress', updated_at = NOW()
       WHERE id = (SELECT id FROM issues WHERE assignee_agent_id = $1 AND status IN ('todo', 'backlog')
         ORDER BY CASE WHEN status = 'todo' THEN 0 ELSE 1 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at ASC LIMIT 1)
       RETURNING id, title, description, goal_id, project_id`,
      [agentId],
    )
    if (checkout.rows.length > 0) {
      const task = checkout.rows[0]
      this.observatory.logEvent({ company_id: companyId, entity_type: 'issue', entity_id: task.id, actor_type: 'agent', actor_id: agentId, action: 'task_checkout', changes: { title: task.title, previousStatus: 'todo' } })
      return task
    }
    return null
  }

  private async resolveAncestry(companyId: string, task: TaskRow | null): Promise<GoalAncestry | undefined> {
    if (!task) return undefined
    const companyResult = await this.db.query<CompanyMissionRow>(`SELECT description FROM companies WHERE id = $1`, [companyId])
    const mission = companyResult.rows[0]?.description ?? null
    let goal: GoalAncestry['goal'] = null
    if (task.goal_id) {
      const goalResult = await this.db.query<GoalRow>(`SELECT title AS name, description FROM goals WHERE id = $1`, [task.goal_id])
      if (goalResult.rows[0]) goal = { name: goalResult.rows[0].name, description: goalResult.rows[0].description }
    }
    let project: GoalAncestry['project'] = null
    if (task.project_id) {
      const r = await this.db.query<ProjectRow>(`SELECT name, description FROM projects WHERE id = $1`, [task.project_id])
      if (r.rows[0]) project = { name: r.rows[0].name, description: r.rows[0].description }
    } else if (task.goal_id) {
      const r = await this.db.query<ProjectRow>(`SELECT name, description FROM projects WHERE goal_id = $1 LIMIT 1`, [task.goal_id])
      if (r.rows[0]) project = { name: r.rows[0].name, description: r.rows[0].description }
    }
    return { mission, project, goal, task: { title: task.title, description: task.description } }
  }

  private async getRecentActivity(companyId: string, since: string | null): Promise<ActivityLogEntry[]> {
    const q = since
      ? { sql: `SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at FROM activity_log WHERE company_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT $3`, params: [companyId, since, MAX_RECENT_ACTIVITY] }
      : { sql: `SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at FROM activity_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`, params: [companyId, MAX_RECENT_ACTIVITY] }
    return (await this.db.query<ActivityLogEntry>(q.sql, q.params)).rows
  }

  private async getAssignedTasks(agentId: string): Promise<Issue[]> {
    return (await this.db.query<Issue>(`SELECT * FROM issues WHERE assignee_agent_id = $1 AND status = 'in_progress' ORDER BY created_at DESC`, [agentId])).rows
  }

  private async getUnreadComments(agentId: string, since: string | null): Promise<IssueComment[]> {
    if (!since) return []
    return (await this.db.query<IssueComment>(
      `SELECT ic.* FROM issue_comments ic JOIN issues i ON ic.issue_id = i.id WHERE i.assignee_agent_id = $1 AND ic.created_at > $2 AND (ic.author_agent_id IS NULL OR ic.author_agent_id != $1) ORDER BY ic.created_at DESC LIMIT $3`,
      [agentId, since, MAX_RECENT_ACTIVITY],
    )).rows
  }

  private async getDelegationContext(agentId: string, task: TaskRow | null): Promise<{ delegatedBy?: string; subTasks?: Array<{ id: string; title: string; status: string }> } | undefined> {
    if (!task) return undefined
    let delegatedBy: string | undefined
    const parentResult = await this.db.query<{ assignee_agent_id: string | null; id: string }>(
      `SELECT p.assignee_agent_id, p.id FROM issues p JOIN issues c ON c.parent_id = p.id WHERE c.id = $1 AND p.assignee_agent_id IS NOT NULL AND p.assignee_agent_id != $2`,
      [task.id, agentId],
    )
    if (parentResult.rows.length > 0) delegatedBy = parentResult.rows[0].assignee_agent_id ?? undefined
    const childResult = await this.db.query<{ id: string; title: string; status: string }>(
      `SELECT c.id, c.title, c.status FROM issues c JOIN issues p ON c.parent_id = p.id WHERE p.assignee_agent_id = $1 ORDER BY c.created_at ASC`,
      [agentId],
    )
    const subTasks = childResult.rows.length > 0 ? childResult.rows : undefined
    if (!delegatedBy && !subTasks) return undefined
    return { delegatedBy, subTasks }
  }

  private executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, adapter?: AdapterModule): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; if (adapter?.abort) adapter.abort(); reject(new TimeoutError(`Timed out after ${timeoutMs}ms`)) } }, timeoutMs)
      fn().then((result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } })
        .catch((err: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(err) } })
    })
  }
}

class TimeoutError extends Error {
  constructor(message: string) { super(message); this.name = 'TimeoutError' }
}
