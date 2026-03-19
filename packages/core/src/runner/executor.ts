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

  constructor(
    db: DatabaseProvider,
    costTracker: CostTracker,
    observatory: Observatory,
    adapterRegistry: AdapterRegistry,
    governance?: GovernanceEngine,
    quotaManager?: QuotaManager,
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
        const policyResult = await this.governance.checkPolicy(
          companyId,
          agentId,
          agent.adapter_type,
        )


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
            changes: {
              trigger,
              adapter: agent.adapter_type,
              policyId: policyResult.policyId ?? null,
              reason: policyResult.reason,
            },
          })

          events.emit('error', { message: errMsg })

          return { exitCode: 1, stderr: errMsg }
        }
      }

      // ── Step 5: Build context ───────────────────────────────────────
      const sessionState = await getLastSessionState(agentId, this.db)
      const task = await this.getAssignedTask(agentId, companyId)

      // Build agent communication context (async awareness)
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

      // -- Step 5b: Load secrets as env vars --
      let secretEnv: Record<string, string> = {}
      try {
        secretEnv = await this.secretsManager.getAllDecrypted(companyId)
        const secretValues = Object.values(secretEnv)
        this.logRedactor.addSecrets(secretValues)
      } catch {
        // Non-fatal -- continue without secrets
      }

      const ctx: AdapterContext = {
        agentId,
        companyId,
        task: task?.title ?? undefined,
        heartbeatRunId: runId,
        adapterConfig,
        env: { ...secretEnv },
        sessionState,
        recentActivity,
        assignedTasks,
        unreadComments,
        ancestry,
        delegatedBy: delegationCtx?.delegatedBy,
        subTasks: delegationCtx?.subTasks,
        systemContext,
      }

      events.emit('context_built', {
        hasTask: !!task,
        hasSessionState: !!sessionState,
        recentActivityCount: recentActivity.length,
        unreadCommentsCount: unreadComments.length,
      })

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

      events.emit('adapter_started', { adapterType: agent.adapter_type, timeoutS })

      let adapterResult: AdapterResult
      let timedOut = false

      try {
        adapterResult = await this.executeWithTimeout(
          () => adapter.execute(ctx),
          timeoutMs,
          adapter,
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

      // -- Step 6b: Redact secrets from adapter output --
      if (adapterResult.stdout) {
        adapterResult = { ...adapterResult, stdout: this.logRedactor.redact(adapterResult.stdout) }
      }
      if (adapterResult.stderr) {
        adapterResult = { ...adapterResult, stderr: this.logRedactor.redact(adapterResult.stderr) }
      }

      events.emit('adapter_finished', {
        exitCode: adapterResult.exitCode,
        timedOut,
        adapterType: agent.adapter_type,
      })

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


      if (adapterResult.usage) {
        events.emit('cost_recorded', {
          provider: adapterResult.usage.provider,
          model: adapterResult.usage.model,
          costCents: adapterResult.usage.costCents,
        })
      }

      // ── Step 9: Save session state ──────────────────────────────────
      if (adapterResult.sessionState) {
        await saveSessionState(runId, adapterResult.sessionState, this.db)
      }


      if (adapterResult.sessionState) {
        events.emit('session_saved', { sessionState: adapterResult.sessionState })
      }

      // ── Step 9b: Record tool calls ─────────────────────────────────
      if (adapterResult.toolCalls && adapterResult.toolCalls.length > 0) {
        await this.recordToolCalls(
          runId,
          agentId,
          companyId,
          adapterResult.toolCalls,
        )
      }

      // ── Step 9c: Update task status if agent reported one ──────────
      if (adapterResult.taskStatus && task) {
        try {
          // Honesty Gate: if agent is marking task as done, verify checklist first
          if (adapterResult.taskStatus === 'done') {
            const gate = await checkHonestyGate(this.db, task.id, companyId)
            if (!gate.passed) {
              this.observatory.logEvent({
                company_id: companyId,
                entity_type: 'issue',
                entity_id: task.id,
                actor_type: 'agent',
                actor_id: agentId,
                action: 'honesty_gate_blocked',
                changes: {
                  title: task.title,
                  reason: gate.reason,
                  uncheckedItems: gate.uncheckedItems ?? [],
                },
              })
              events.emit('error', {
                message: `Honesty gate blocked task completion: ${gate.reason}`,
              })
            } else {
              await this.db.query(
                `UPDATE issues SET status = $1, updated_at = NOW() WHERE id = $2`,
                [adapterResult.taskStatus, task.id],
              )
              this.observatory.logEvent({
                company_id: companyId,
                entity_type: 'issue',
                entity_id: task.id,
                actor_type: 'agent',
                actor_id: agentId,
                action: `task_${adapterResult.taskStatus}`,
                changes: { title: task.title, newStatus: adapterResult.taskStatus },
              })
            }
          } else {
            await this.db.query(
              `UPDATE issues SET status = $1, updated_at = NOW() WHERE id = $2`,
              [adapterResult.taskStatus, task.id],
            )
            this.observatory.logEvent({
              company_id: companyId,
              entity_type: 'issue',
              entity_id: task.id,
              actor_type: 'agent',
              actor_id: agentId,
              action: `task_${adapterResult.taskStatus}`,
              changes: { title: task.title, newStatus: adapterResult.taskStatus },
            })
          }
        } catch {
          // Best-effort — don’t fail the heartbeat for status update errors
        }
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

      events.emit('error', { message: errMsg })

      await this.markRunFailed(runId, errMsg)
      await this.markAgentIdle(agentId)

      return { exitCode: 1, stderr: errMsg }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Insert tool call records for a heartbeat run.
   * Best-effort — failures here should not fail the heartbeat.
   */
  private async recordToolCalls(
    runId: string,
    agentId: string,
    companyId: string,
    toolCalls: NonNullable<AdapterResult['toolCalls']>,
  ): Promise<void> {
    try {
      for (const tc of toolCalls) {
        await this.db.query(
          `INSERT INTO tool_calls (heartbeat_run_id, agent_id, company_id, tool_name, tool_input, tool_output, duration_ms, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            runId,
            agentId,
            companyId,
            tc.toolName,
            tc.toolInput ? JSON.stringify(tc.toolInput) : null,
            tc.toolOutput ?? null,
            tc.durationMs ?? null,
            tc.status ?? 'success',
          ],
        )
      }
    } catch {
      // Best-effort — don't let tool call logging fail the heartbeat
    }
  }

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

  /**
   * Get or checkout the next task for this agent.
   *
   * 1. Return an existing in_progress task (agent is already working on it).
   * 2. If none, atomically checkout the highest-priority todo/backlog task
   *    assigned to this agent (UPDATE ... RETURNING in a single statement).
   * 3. Log the checkout to Observatory.
   */
  private async getAssignedTask(agentId: string, companyId: string): Promise<TaskRow | null> {
    // Step 1: Check for an existing in_progress task
    const inProgress = await this.db.query<TaskRow>(
      `SELECT id, title, description, goal_id, project_id FROM issues
       WHERE assignee_agent_id = $1 AND status = 'in_progress'
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId],
    )
    if (inProgress.rows.length > 0) {
      return inProgress.rows[0]
    }

    // Step 2: Atomically checkout the next todo or backlog task.
    // Priority order: todo before backlog, then by priority weight, then oldest first.
    // Uses a single UPDATE ... RETURNING to prevent race conditions.
    // NOTE: PGlite does not support FOR UPDATE SKIP LOCKED, so we use a
    // simple subquery approach. This is safe for single-process PGlite usage.
    const checkout = await this.db.query<TaskRow>(
      `UPDATE issues SET status = 'in_progress', updated_at = NOW()
       WHERE id = (
         SELECT id FROM issues
         WHERE assignee_agent_id = $1 AND status IN ('todo', 'backlog')
         ORDER BY
           CASE WHEN status = 'todo' THEN 0 ELSE 1 END,
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
           created_at ASC
         LIMIT 1
       )
       RETURNING id, title, description, goal_id, project_id`,
      [agentId],
    )

    if (checkout.rows.length > 0) {
      const task = checkout.rows[0]

      // Step 3: Log the checkout to Observatory (non-blocking, fire-and-forget)
      this.observatory.logEvent({
        company_id: companyId,
        entity_type: 'issue',
        entity_id: task.id,
        actor_type: 'agent',
        actor_id: agentId,
        action: 'task_checkout',
        changes: { title: task.title, previousStatus: 'todo' },
      })

      return task
    }

    return null
  }

  /**
   * Resolve the full ancestry chain for a task: mission → project → goal → task.
   * Returns null if no task is assigned.
   */
  private async resolveAncestry(
    companyId: string,
    task: TaskRow | null,
  ): Promise<GoalAncestry | undefined> {
    if (!task) return undefined

    // Fetch mission from the company
    const companyResult = await this.db.query<CompanyMissionRow>(
      `SELECT description FROM companies WHERE id = $1`,
      [companyId],
    )
    const mission = companyResult.rows[0]?.description ?? null

    // Resolve goal if linked
    let goal: GoalAncestry['goal'] = null

    if (task.goal_id) {
      const goalResult = await this.db.query<GoalRow>(
        `SELECT title AS name, description FROM goals WHERE id = $1`,
        [task.goal_id],
      )
      if (goalResult.rows[0]) {
        goal = {
          name: goalResult.rows[0].name,
          description: goalResult.rows[0].description,
        }
      }
    }

    // Resolve project: prefer issue's project_id, fall back to project linked to goal
    let project: GoalAncestry['project'] = null

    if (task.project_id) {
      const projectResult = await this.db.query<ProjectRow>(
        `SELECT name, description FROM projects WHERE id = $1`,
        [task.project_id],
      )
      if (projectResult.rows[0]) {
        project = {
          name: projectResult.rows[0].name,
          description: projectResult.rows[0].description,
        }
      }
    } else if (task.goal_id) {
      // Fall back: find project linked to this goal
      const projectResult = await this.db.query<ProjectRow>(
        `SELECT name, description FROM projects WHERE goal_id = $1 LIMIT 1`,
        [task.goal_id],
      )
      if (projectResult.rows[0]) {
        project = {
          name: projectResult.rows[0].name,
          description: projectResult.rows[0].description,
        }
      }
    }

    return {
      mission,
      project,
      goal,
      task: { title: task.title, description: task.description },
    }
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

  /**
   * Load delegation context for the current agent and task.
   * - delegatedBy: agent ID of whoever assigned the parent issue (if task has parent_id)
   * - subTasks: child issues where parent's assignee is this agent
   */
  private async getDelegationContext(
    agentId: string,
    task: TaskRow | null,
  ): Promise<{ delegatedBy?: string; subTasks?: Array<{ id: string; title: string; status: string }> } | undefined> {
    if (!task) return undefined

    // Check if current task was delegated (has parent, and parent has a different assignee)
    let delegatedBy: string | undefined
    const parentResult = await this.db.query<{ assignee_agent_id: string | null; id: string }>(
      `SELECT p.assignee_agent_id, p.id FROM issues p
       JOIN issues c ON c.parent_id = p.id
       WHERE c.id = $1 AND p.assignee_agent_id IS NOT NULL AND p.assignee_agent_id != $2`,
      [task.id, agentId],
    )
    if (parentResult.rows.length > 0) {
      delegatedBy = parentResult.rows[0].assignee_agent_id ?? undefined
    }

    // Load child tasks this agent delegated (issues where this agent is assignee of parent)
    const childResult = await this.db.query<{ id: string; title: string; status: string }>(
      `SELECT c.id, c.title, c.status FROM issues c
       JOIN issues p ON c.parent_id = p.id
       WHERE p.assignee_agent_id = $1
       ORDER BY c.created_at ASC`,
      [agentId],
    )
    const subTasks = childResult.rows.length > 0 ? childResult.rows : undefined

    if (!delegatedBy && !subTasks) return undefined
    return { delegatedBy, subTasks }
  }

  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    adapter?: AdapterModule,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          if (adapter?.abort) adapter.abort()
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
