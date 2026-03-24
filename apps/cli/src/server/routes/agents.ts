/**
 * Agent CRUD + lifecycle routes — /api/companies/:id/agents
 */

import { Hono, type Context } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import type { Agent, AgentApiKey, AgentConfigRevision, Company } from '@shackleai/shared'
import { CreateAgentInput, UpdateAgentInput, TriggerType } from '@shackleai/shared'
import { AgentStatus, AgentApiKeyStatus, BoardGuardedMutation } from '@shackleai/shared'
import type { Scheduler } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { verifyJwt } from './auth.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

// ---------------------------------------------------------------------------
// State machine -- valid transitions for lifecycle actions
// ---------------------------------------------------------------------------

/** Statuses from which an agent may be paused. */
const PAUSABLE_STATUSES: ReadonlySet<string> = new Set([AgentStatus.Idle, AgentStatus.Active])

/** Statuses from which an agent may be resumed. */
const RESUMABLE_STATUSES: ReadonlySet<string> = new Set([AgentStatus.Paused])

// ---------------------------------------------------------------------------
// Board guard helper
// ---------------------------------------------------------------------------

/**
 * Check if the company board is claimed. If claimed, extract the caller
 * userId via JWT and verify they are the holder.
 *
 * Returns null if the operation is allowed, or a Response to short-circuit.
 */
async function checkBoardGuard(
  c: Context<{ Variables: Variables }>,
  company: Company,
  mutationType: BoardGuardedMutation,
  db: DatabaseProvider,
): Promise<Response | null> {
  if (!company.board_claimed_by) {
    return null
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'Board authority required',
        detail: `Mutation "${mutationType}" requires board authority. The board is currently claimed -- provide a valid JWT.`,
      },
      403,
    )
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return c.json(
      {
        error: 'Board authority required',
        detail: `Mutation "${mutationType}" requires board authority. The board is currently claimed -- provide a valid JWT.`,
      },
      403,
    )
  }

  const payload = verifyJwt(token)
  if (!payload) {
    return c.json(
      {
        error: 'Board authority required',
        detail: `Mutation "${mutationType}" requires board authority. Invalid or expired token.`,
      },
      403,
    )
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await db.query<{ id: string }>(
    'SELECT id FROM user_sessions WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash],
  )
  if (session.rows.length === 0) {
    return c.json(
      {
        error: 'Board authority required',
        detail: `Mutation "${mutationType}" requires board authority. Session expired or invalidated.`,
      },
      403,
    )
  }

  if (company.board_claimed_by !== payload.sub) {
    return c.json(
      {
        error: 'Board authority required',
        detail: `Mutation "${mutationType}" requires board authority. The board is currently claimed by another user.`,
      },
      403,
    )
  }

  return null
}

/**
 * Snapshot the current agent config as a revision before updating.
 * Returns the new revision number.
 */
async function createConfigRevision(
  db: DatabaseProvider,
  agent: Agent,
  changedBy?: string | null,
  changeReason?: string | null,
): Promise<number> {
  const maxResult = await db.query<{ max_rev: number | null }>(
    `SELECT MAX(revision_number) as max_rev FROM agent_config_revisions WHERE agent_id = $1`,
    [agent.id],
  )
  const nextRev = (maxResult.rows[0]?.max_rev ?? 0) + 1

  const configSnapshot = {
    name: agent.name,
    title: agent.title,
    role: agent.role,
    status: agent.status,
    reports_to: agent.reports_to,
    capabilities: agent.capabilities,
    adapter_type: agent.adapter_type,
    adapter_config: agent.adapter_config,
    budget_monthly_cents: agent.budget_monthly_cents,
  }

  await db.query(
    `INSERT INTO agent_config_revisions (agent_id, revision_number, config_snapshot, changed_by, change_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [agent.id, nextRev, JSON.stringify(configSnapshot), changedBy ?? null, changeReason ?? null],
  )

  return nextRev
}
export function agentsRouter(db: DatabaseProvider, scheduler?: Scheduler): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/agents
  app.get('/:id/agents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)
    const result = await db.query<Agent>(
      `SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/agents -- create agent
  app.post('/:id/agents', companyScope, async (c) => {
    const companyId = c.req.param('id')

    // Board guard
    const createCompany = c.get('company')
    const createGuard = await checkBoardGuard(c, createCompany, BoardGuardedMutation.AgentCreate, db)
    if (createGuard) return createGuard

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateAgentInput.safeParse({ company_id: companyId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const {
      name,
      title,
      role,
      status,
      reports_to,
      capabilities,
      adapter_type,
      adapter_config,
      budget_monthly_cents,
      llm_config_id,
    } = parsed.data

    const company = c.get('company')
    const requireApproval = company.require_approval === true

    if (requireApproval) {
      const approvalResult = await db.query<{ id: string }>(
        `INSERT INTO approvals (company_id, type, payload, requested_by)
         VALUES ($1, 'agent_create', $2, $3)
         RETURNING id`,
        [
          companyId,
          JSON.stringify({
            name,
            title: title ?? null,
            role,
            status,
            reports_to: reports_to ?? null,
            capabilities: capabilities ?? null,
            adapter_type,
            adapter_config,
            budget_monthly_cents,
            llm_config_id: llm_config_id ?? null,
          }),
          null,
        ],
      )

      return c.json(
        { data: { approval_id: approvalResult.rows[0].id, status: 'pending_approval' } },
        202,
      )
    }

    const result = await db.query<Agent>(
      `INSERT INTO agents
         (company_id, name, title, role, status, reports_to, capabilities,
          adapter_type, adapter_config, budget_monthly_cents, llm_config_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        companyId,
        name,
        title ?? null,
        role,
        status,
        reports_to ?? null,
        capabilities ?? null,
        adapter_type,
        JSON.stringify(adapter_config),
        budget_monthly_cents,
        llm_config_id ?? null,
      ],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/agents/:agentId
  app.get('/:id/agents/:agentId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const result = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // PATCH /api/companies/:id/agents/:agentId -- update agent
  app.patch('/:id/agents/:agentId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    // Board guard
    const patchCompany = c.get('company')
    const patchGuard = await checkBoardGuard(c, patchCompany, BoardGuardedMutation.BudgetChange, db)
    if (patchGuard) return patchGuard

    const existing = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateAgentInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<Agent>(
        `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
        [agentId, companyId],
      )
      return c.json({ data: result.rows[0] })
    }

    const changeReason = (body as Record<string, unknown>)?.change_reason as string | undefined
    const changedBy = (body as Record<string, unknown>)?.changed_by as string | undefined
    await createConfigRevision(db, existing.rows[0], changedBy, changeReason)

    const setClauses = fields
      .map((f, i) => {
        if (f === 'adapter_config') return `${f} = $${i + 3}`
        return `${f} = $${i + 3}`
      })
      .join(', ')

    const values = fields.map((f) => {
      const val = updates[f]
      if (f === 'adapter_config' && val !== undefined) return JSON.stringify(val)
      return val
    })

    const result = await db.query<Agent>(
      `UPDATE agents SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [agentId, companyId, ...values],
    )

    return c.json({ data: result.rows[0] })
  })

  // GET /api/companies/:id/agents/:agentId/revisions
  app.get('/:id/agents/:agentId/revisions', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const agentResult = await db.query<Agent>(
      `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (agentResult.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const { limit, offset } = parsePagination(c)
    const result = await db.query<AgentConfigRevision>(
      `SELECT * FROM agent_config_revisions WHERE agent_id = $1
       ORDER BY revision_number DESC LIMIT $2 OFFSET $3`,
      [agentId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/agents/:agentId/rollback/:revisionId
  app.post('/:id/agents/:agentId/rollback/:revisionId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')
    const revisionId = c.req.param('revisionId')

    const agentResult = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (agentResult.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const revResult = await db.query<AgentConfigRevision>(
      `SELECT * FROM agent_config_revisions WHERE id = $1 AND agent_id = $2`,
      [revisionId, agentId],
    )
    if (revResult.rows.length === 0) {
      return c.json({ error: 'Revision not found' }, 404)
    }

    const revision = revResult.rows[0]
    const snapshot = typeof revision.config_snapshot === 'string'
      ? JSON.parse(revision.config_snapshot) as Record<string, unknown>
      : revision.config_snapshot

    await createConfigRevision(db, agentResult.rows[0], null, `Rollback to revision ${revision.revision_number}`)

    const result = await db.query<Agent>(
      `UPDATE agents SET
         name = $3,
         title = $4,
         role = $5,
         status = $6,
         reports_to = $7,
         capabilities = $8,
         adapter_type = $9,
         adapter_config = $10,
         budget_monthly_cents = $11,
         updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [
        agentId,
        companyId,
        snapshot.name,
        snapshot.title ?? null,
        snapshot.role,
        snapshot.status,
        snapshot.reports_to ?? null,
        snapshot.capabilities ?? null,
        snapshot.adapter_type,
        JSON.stringify(snapshot.adapter_config ?? {}),
        snapshot.budget_monthly_cents ?? 0,
      ],
    )

    return c.json({
      data: {
        agent: result.rows[0],
        rolled_back_to: revision.revision_number,
      },
    })
  })

  // POST /api/companies/:id/agents/:agentId/pause
  app.post('/:id/agents/:agentId/pause', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const existing = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const current = existing.rows[0]
    if (!PAUSABLE_STATUSES.has(current.status)) {
      return c.json(
        {
          error: 'Invalid state transition',
          detail: `Cannot pause agent in "${current.status}" status. Pause is only allowed from: ${[...PAUSABLE_STATUSES].join(', ')}.`,
        },
        409,
      )
    }

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Paused, agentId, companyId],
    )

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/resume
  app.post('/:id/agents/:agentId/resume', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const existing = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const current = existing.rows[0]
    if (!RESUMABLE_STATUSES.has(current.status)) {
      return c.json(
        {
          error: 'Invalid state transition',
          detail: `Cannot resume agent in "${current.status}" status. Resume is only allowed from: ${[...RESUMABLE_STATUSES].join(', ')}.`,
        },
        409,
      )
    }

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Idle, agentId, companyId],
    )

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/terminate
  app.post('/:id/agents/:agentId/terminate', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const existing = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const current = existing.rows[0]
    if (current.status === AgentStatus.Terminated) {
      return c.json(
        {
          error: 'Invalid state transition',
          detail: 'Agent is already terminated.',
        },
        409,
      )
    }

    const result = await db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [AgentStatus.Terminated, agentId, companyId],
    )

    return c.json({ data: result.rows[0] })
  })

  // POST /api/companies/:id/agents/:agentId/wakeup
  app.post('/:id/agents/:agentId/wakeup', companyScope, async (c) => {
    const companyId = c.req.param('id') as string
    const agentId = c.req.param('agentId') as string

    const agentResult = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )

    if (agentResult.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const agent = agentResult.rows[0]
    const adapterType = agent.adapter_type
    const needsOpenAI = ['crewai', 'openclaw'].includes(adapterType)
    const needsAnthropic = adapterType === 'claude'

    if (needsOpenAI && !process.env.OPENAI_API_KEY) {
      return c.json({
        error: 'OpenAI API key not configured. Go to Settings \u2192 LLM API Keys and add your OpenAI key, then restart the server.',
        code: 'MISSING_LLM_KEY',
      }, 400)
    }
    // Claude adapter spawns `claude` CLI which uses the user's Claude subscription.
    // No separate ANTHROPIC_API_KEY needed — only warn if claude CLI is not installed.
    if (needsAnthropic && !process.env.ANTHROPIC_API_KEY) {
      // Check if claude CLI is available (Max subscription)
      try {
        require('child_process').execSync('claude --version', { stdio: 'ignore' })
        // claude CLI found — proceed without API key
      } catch {
        return c.json({
          error: 'Claude not available. Either install Claude Code CLI (claude.com/claude-code) or add an Anthropic API key in Settings → LLM API Keys.',
          code: 'MISSING_LLM_KEY',
        }, 400)
      }
    }

    if (!scheduler) {
      const updated = await db.query<Agent>(
        `UPDATE agents SET last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [agentId, companyId],
      )
      return c.json({ data: { agent: updated.rows[0], triggered: false } })
    }

    const runResult = await scheduler.triggerNow(agentId, TriggerType.Manual)

    if (!runResult) {
      const agent = agentResult.rows[0]
      const isAgentRunning = scheduler.isRunning(agentId)
      return c.json({
        data: {
          agent,
          triggered: false,
          queued: isAgentRunning,
          reason: isAgentRunning
            ? 'Agent heartbeat already in progress -- wakeup request queued'
            : 'Execution could not be started',
        },
      })
    }

    const updatedAgent = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )

    return c.json({
      data: {
        agent: updatedAgent.rows[0] ?? agentResult.rows[0],
        triggered: true,
        result: {
          exitCode: runResult.exitCode,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
        },
      },
    })
  })

  // DELETE /api/companies/:id/agents/:agentId -- delete a terminated agent
  app.delete('/:id/agents/:agentId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    // Board guard
    const delCompany = c.get('company')
    const delGuard = await checkBoardGuard(c, delCompany, BoardGuardedMutation.AgentDelete, db)
    if (delGuard) return delGuard

    const existing = await db.query<Agent>(
      `SELECT * FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    if (existing.rows[0].status !== AgentStatus.Terminated) {
      return c.json(
        {
          error: 'Invalid state for deletion',
          detail: `Agent must be terminated before deletion. Current status: "${existing.rows[0].status}".`,
        },
        409,
      )
    }

    await db.query('DELETE FROM agent_config_revisions WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM agent_api_keys WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM heartbeat_runs WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM cost_events WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM tool_calls WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM workspace_policy_rules WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM workspace_operations WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM agent_worktrees WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM agent_wakeup_requests WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM finance_events WHERE agent_id = $1', [agentId])
    await db.query('DELETE FROM quota_windows WHERE agent_id = $1', [agentId])

    await db.query('UPDATE issues SET assignee_agent_id = NULL WHERE assignee_agent_id = $1', [agentId])
    await db.query('UPDATE issue_comments SET author_agent_id = NULL WHERE author_agent_id = $1', [agentId])
    await db.query('UPDATE goals SET owner_agent_id = NULL WHERE owner_agent_id = $1', [agentId])
    await db.query('UPDATE projects SET lead_agent_id = NULL WHERE lead_agent_id = $1', [agentId])
    await db.query('UPDATE policies SET agent_id = NULL WHERE agent_id = $1', [agentId])

    await db.query('DELETE FROM agents WHERE id = $1 AND company_id = $2', [agentId, companyId])

    return c.json({ deleted: true })
  })

  // POST /api/companies/:id/agents/:agentId/api-keys
  app.post('/:id/agents/:agentId/api-keys', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const agentId = c.req.param('agentId')

    const agentResult = await db.query<Agent>(
      `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
      [agentId, companyId],
    )
    if (agentResult.rows.length === 0) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    let label: string | null = null
    try {
      const body = await c.req.json()
      if (body && typeof body === 'object' && 'label' in body && typeof body.label === 'string') {
        label = body.label
      }
    } catch {
      // body is optional
    }

    const plainKey = randomBytes(32).toString('hex')
    const keyHash = createHash('sha256').update(plainKey).digest('hex')

    const result = await db.query<AgentApiKey>(
      `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, label, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, agent_id, company_id, label, status, last_used_at, created_at`,
      [agentId, companyId, keyHash, label, AgentApiKeyStatus.Active],
    )

    return c.json(
      {
        data: {
          ...result.rows[0],
          key: plainKey,
        },
      },
      201,
    )
  })

  return app
}
