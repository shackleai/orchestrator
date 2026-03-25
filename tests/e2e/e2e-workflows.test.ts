/**
 * E2E: Comprehensive Workflow Test Suite
 *
 * Tests 8 complete user workflows through the API:
 *   1. Full Agent Lifecycle (create → pause → resume → terminate)
 *   2. Task Assignment & Auto-trigger (issue → assign → verify wakeup)
 *   3. Governance Enforcement (deny/allow policy matching)
 *   4. Budget Enforcement (soft alert at 80%, hard stop at 100%)
 *   5. Delegation & Rollup (CEO → worker → child issue → parent auto-complete)
 *   6. Secrets Management (store → list → get → delete)
 *   7. Multi-Tenant Isolation (company A cannot see company B's data)
 *   8. Policy Priority Resolution (highest priority wins on conflict)
 *
 * Design rules:
 *  - NO hardcoded values — all names/identifiers use randomUUID
 *  - NO external API calls — process adapter with mock-safe config
 *  - Each describe block is fully independent (own db + app instance)
 *  - skipAuth: true on all suites (auth is covered by auth-specific tests)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'
import { AgentStatus, IssueStatus, PolicyAction } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

type AgentRow = {
  id: string
  name: string
  status: string
  role: string
  reports_to: string | null
  company_id: string
  budget_monthly_cents: number
}

type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  assignee_agent_id: string | null
  parent_id: string | null
}

type PolicyRow = {
  id: string
  name: string
  tool_pattern: string
  action: string
  priority: number
  agent_id: string | null
  company_id: string
}

type SecretListRow = {
  id: string
  name: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Factory helpers — no hardcoded values
// ---------------------------------------------------------------------------

/** Generate a unique company input. */
function testCompanyInput(overrides: Record<string, unknown> = {}) {
  const slug = randomUUID().slice(0, 8)
  return {
    name: `test-co-${slug}`,
    issue_prefix: slug.toUpperCase().slice(0, 4),
    budget_monthly_cents: 10000, // $100
    ...overrides,
  }
}

/** Generate a unique agent input (process adapter — no external deps). */
function testAgentInput(overrides: Record<string, unknown> = {}) {
  return {
    name: `agent-${randomUUID().slice(0, 8)}`,
    role: 'worker',
    adapter_type: 'process',
    adapter_config: { command: 'echo', args: ['hello'] },
    budget_monthly_cents: 5000, // $50
    ...overrides,
  }
}

/** Generate a unique issue input. */
function testIssueInput(overrides: Record<string, unknown> = {}) {
  return {
    title: `task-${randomUUID().slice(0, 8)}`,
    ...overrides,
  }
}

/** Generate a unique policy input. */
function testPolicyInput(overrides: Record<string, unknown> = {}) {
  return {
    name: `policy-${randomUUID().slice(0, 8)}`,
    tool_pattern: '*',
    action: PolicyAction.Allow,
    priority: 10,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// API helpers — thin wrappers that assert status and return typed data
// ---------------------------------------------------------------------------

async function postJson<T>(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  expectedStatus = 201,
): Promise<T> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status, `POST ${path} expected ${expectedStatus} got ${res.status}`).toBe(expectedStatus)
  const json = (await res.json()) as { data: T }
  return json.data
}

async function patchJson<T>(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status, `PATCH ${path} expected 200 got ${res.status}`).toBe(200)
  const json = (await res.json()) as { data: T }
  return json.data
}

async function getJson<T>(
  app: ReturnType<typeof createApp>,
  path: string,
): Promise<T> {
  const res = await app.request(path)
  expect(res.status, `GET ${path} expected 200 got ${res.status}`).toBe(200)
  const json = (await res.json()) as { data: T }
  return json.data
}

async function createCompany(
  app: ReturnType<typeof createApp>,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return postJson(app, '/api/companies', testCompanyInput(overrides))
}

async function createAgent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<AgentRow> {
  return postJson(app, `/api/companies/${companyId}/agents`, testAgentInput(overrides))
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<IssueRow> {
  return postJson(app, `/api/companies/${companyId}/issues`, testIssueInput(overrides))
}

async function createPolicy(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<PolicyRow> {
  return postJson(app, `/api/companies/${companyId}/policies`, testPolicyInput(overrides))
}

// ---------------------------------------------------------------------------
// Suite 1: Full Agent Lifecycle
// ---------------------------------------------------------------------------

describe('E2E: full agent lifecycle — create → pause → resume → terminate', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app)
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates agent with idle status', async () => {
    const agent = await createAgent(app, companyId, { name: `lifecycle-agent-${randomUUID().slice(0, 6)}` })
    agentId = agent.id
    expect(agent.id).toBeTruthy()
    expect(agent.status).toBe(AgentStatus.Idle)
    expect(agent.company_id).toBe(companyId)
  })

  it('agent appears in GET /agents list', async () => {
    const agents = await getJson<AgentRow[]>(app, `/api/companies/${companyId}/agents`)
    const found = agents.find((a) => a.id === agentId)
    expect(found).toBeDefined()
    expect(found!.status).toBe(AgentStatus.Idle)
  })

  it('agent is retrievable by id via GET /agents/:agentId', async () => {
    const agent = await getJson<AgentRow>(app, `/api/companies/${companyId}/agents/${agentId}`)
    expect(agent.id).toBe(agentId)
    expect(agent.status).toBe(AgentStatus.Idle)
  })

  it('pauses agent via POST /agents/:id/pause — status becomes paused', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Paused)
  })

  it('GET /agents/:id confirms status is paused', async () => {
    const agent = await getJson<AgentRow>(app, `/api/companies/${companyId}/agents/${agentId}`)
    expect(agent.status).toBe(AgentStatus.Paused)
  })

  it('returns 409 when pausing an already-paused agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid state transition')
  })

  it('resumes agent via POST /agents/:id/resume — status becomes idle', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/resume`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Idle)
  })

  it('GET /agents/:id confirms status is idle after resume', async () => {
    const agent = await getJson<AgentRow>(app, `/api/companies/${companyId}/agents/${agentId}`)
    expect(agent.status).toBe(AgentStatus.Idle)
  })

  it('returns 409 when resuming an idle (not paused) agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/resume`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid state transition')
  })

  it('terminates agent via POST /agents/:id/terminate — status becomes terminated', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/terminate`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  it('GET /agents/:id confirms status is terminated', async () => {
    const agent = await getJson<AgentRow>(app, `/api/companies/${companyId}/agents/${agentId}`)
    expect(agent.status).toBe(AgentStatus.Terminated)
  })

  it('returns 409 when terminating an already-terminated agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}/terminate`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid state transition')
  })
})

// ---------------------------------------------------------------------------
// Suite 2: Task Assignment & Scheduler Trigger
// ---------------------------------------------------------------------------

describe('E2E: task assignment — issue assigned to agent triggers task_assigned wakeup', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string
  let triggeredAgentId: string | null = null

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)

    // Inject a minimal scheduler stub that records the triggered agent
    const schedulerStub = {
      triggerNow: async (id: string, trigger: string) => {
        triggeredAgentId = id
        void trigger
        return null
      },
      isRunning: (_id: string) => false,
      start: async () => {},
      stop: async () => {},
    }

    app = createApp(db, {
      skipAuth: true,
      scheduler: schedulerStub as unknown as Parameters<typeof createApp>[1]['scheduler'],
    })

    const company = await createCompany(app)
    companyId = company.id
    const agent = await createAgent(app, companyId)
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates issue without assignee — starts in backlog', async () => {
    const issue = await createIssue(app, companyId)
    expect(issue.status).toBe(IssueStatus.Backlog)
    expect(issue.assignee_agent_id).toBeNull()
  })

  it('creates issue with assignee_agent_id — fires task_assigned trigger', async () => {
    triggeredAgentId = null

    const issue = await createIssue(app, companyId, {
      assignee_agent_id: agentId,
    })

    expect(issue.assignee_agent_id).toBe(agentId)
    // Scheduler triggerNow should have been called with the agent's id
    expect(triggeredAgentId).toBe(agentId)
  })

  it('PATCH assignee_agent_id on existing issue fires task_assigned trigger', async () => {
    // Create unassigned issue first
    const issue = await createIssue(app, companyId)
    expect(issue.assignee_agent_id).toBeNull()

    triggeredAgentId = null

    // Assign via PATCH
    const updated = await patchJson<IssueRow>(
      app,
      `/api/companies/${companyId}/issues/${issue.id}`,
      { assignee_agent_id: agentId },
    )

    expect(updated.assignee_agent_id).toBe(agentId)
    expect(triggeredAgentId).toBe(agentId)
  })

  it('checkout sets issue to in_progress and assigns agent', async () => {
    const issue = await createIssue(app, companyId)
    expect(issue.status).toBe(IssueStatus.Backlog)

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe(IssueStatus.InProgress)
    expect(body.data.assignee_agent_id).toBe(agentId)
  })

  it('second checkout of same issue returns 409 (already claimed)', async () => {
    const issue = await createIssue(app, companyId)

    // First checkout succeeds
    await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })

    // Second checkout conflicts
    const second = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })
    expect(second.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// Suite 3: Governance Enforcement
// ---------------------------------------------------------------------------

describe('E2E: governance enforcement — deny/allow policy matching via GovernanceEngine', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app)
    companyId = company.id
    const agent = await createAgent(app, companyId)
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('no policies exist initially', async () => {
    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    expect(policies).toHaveLength(0)
  })

  it('creates DENY policy for "dangerous.*" pattern', async () => {
    const policy = await createPolicy(app, companyId, {
      name: `deny-dangerous-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'dangerous.*',
      action: PolicyAction.Deny,
      priority: 100,
      agent_id: agentId,
    })
    expect(policy.action).toBe(PolicyAction.Deny)
    expect(policy.tool_pattern).toBe('dangerous.*')
    expect(policy.priority).toBe(100)
  })

  it('creates ALLOW policy for "safe.*" pattern with lower priority', async () => {
    const policy = await createPolicy(app, companyId, {
      name: `allow-safe-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'safe.*',
      action: PolicyAction.Allow,
      priority: 10,
      agent_id: agentId,
    })
    expect(policy.action).toBe(PolicyAction.Allow)
    expect(policy.tool_pattern).toBe('safe.*')
  })

  it('both policies appear in GET /policies', async () => {
    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    expect(policies).toHaveLength(2)
    const actions = policies.map((p) => p.action)
    expect(actions).toContain(PolicyAction.Deny)
    expect(actions).toContain(PolicyAction.Allow)
  })

  it('policies are ordered by priority DESC in API response', async () => {
    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    // Highest priority first
    expect(policies[0].priority).toBeGreaterThanOrEqual(policies[1].priority)
  })

  it('can update a policy priority via PATCH', async () => {
    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    const denyPolicy = policies.find((p) => p.action === PolicyAction.Deny)!

    const updated = await patchJson<PolicyRow>(
      app,
      `/api/companies/${companyId}/policies/${denyPolicy.id}`,
      { priority: 200 },
    )
    expect(updated.priority).toBe(200)
  })

  it('GovernanceEngine denies "dangerous.tool" for this agent', async () => {
    // Drive governance directly through the core engine (same DB)
    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)
    const result = await engine.checkPolicy(companyId, agentId, 'dangerous.tool')
    expect(result.allowed).toBe(false)
  })

  it('GovernanceEngine allows "safe.tool" for this agent', async () => {
    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)
    const result = await engine.checkPolicy(companyId, agentId, 'safe.tool')
    expect(result.allowed).toBe(true)
  })

  it('deletes a policy via DELETE and it no longer appears', async () => {
    const before = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    const target = before[0]

    const res = await app.request(`/api/companies/${companyId}/policies/${target.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)

    const after = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    expect(after.find((p) => p.id === target.id)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Suite 4: Budget Enforcement
// ---------------------------------------------------------------------------

describe('E2E: budget enforcement — soft alert at 80%, hard stop at 100%', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    // Company with $10 budget (1000 cents)
    const company = await createCompany(app, { budget_monthly_cents: 1000 })
    companyId = company.id

    // Agent with $5 budget (500 cents)
    const agent = await createAgent(app, companyId, { budget_monthly_cents: 500 })
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  async function postCostEvent(agentIdParam: string, costCents: number) {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentIdParam,
        input_tokens: 100,
        output_tokens: 50,
        cost_cents: costCents,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      }),
    })
    expect(res.status, `POST /costs/events expected 201 got ${res.status}`).toBe(201)
    return (await res.json()) as { data: { cost_cents: number } }
  }

  it('company is created with correct budget_monthly_cents: 1000', async () => {
    const company = await getJson<{ budget_monthly_cents: number }>(
      app,
      `/api/companies/${companyId}`,
    )
    expect(company.budget_monthly_cents).toBe(1000)
  })

  it('agent is created with correct budget_monthly_cents: 500', async () => {
    const agent = await getJson<AgentRow>(app, `/api/companies/${companyId}/agents/${agentId}`)
    expect(agent.budget_monthly_cents).toBe(500)
  })

  it('no cost events exist initially', async () => {
    const events = await getJson<unknown[]>(app, `/api/companies/${companyId}/costs`)
    expect(events).toHaveLength(0)
  })

  it('records $4.00 (400 cents) — agent is under 80% threshold', async () => {
    await postCostEvent(agentId, 400)

    // CostTracker: 400/500 = 80% — at threshold but not past it
    const { CostTracker } = await import('../../packages/core/src/cost-tracker.js')
    const tracker = new CostTracker(db)
    const status = await tracker.checkBudget(companyId, agentId)
    expect(status.withinBudget).toBe(true)
    expect(status.percentUsed).toBe(80)
    expect(status.softAlert).toBe(true) // 80% triggers soft alert
  })

  it('records additional $1.01 (101 cents) — agent exceeds 100% budget (hard stop)', async () => {
    await postCostEvent(agentId, 101)

    const { CostTracker } = await import('../../packages/core/src/cost-tracker.js')
    const tracker = new CostTracker(db)
    const status = await tracker.checkBudget(companyId, agentId)
    // 501/500 > 100%
    expect(status.withinBudget).toBe(false)
    expect(status.percentUsed).toBeGreaterThan(100)
    expect(status.softAlert).toBe(true)
  })

  it('GET /costs/by-agent shows correct aggregation for agent', async () => {
    const byAgent = await getJson<Array<{
      agent_id: string
      total_cost_cents: number
      event_count: number
    }>>(app, `/api/companies/${companyId}/costs/by-agent`)

    const entry = byAgent.find((e) => e.agent_id === agentId)
    expect(entry).toBeDefined()
    expect(entry!.total_cost_cents).toBe(501) // 400 + 101
    expect(entry!.event_count).toBe(2)
  })

  it('dashboard totalSpendCents reflects all recorded cost events', async () => {
    const dashboard = await getJson<{ totalSpendCents: number }>(
      app,
      `/api/companies/${companyId}/dashboard`,
    )
    expect(dashboard.totalSpendCents).toBe(501)
  })

  it('returns 400 on POST /costs/events with missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }), // missing input_tokens, output_tokens, cost_cents
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// Suite 5: Delegation & Parent Rollup
// ---------------------------------------------------------------------------

describe('E2E: delegation & rollup — CEO delegates to worker, parent auto-completes', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let ceoAgentId: string
  let workerAgentId: string
  let parentIssueId: string
  let childIssueIds: string[]

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app)
    companyId = company.id

    // CEO agent (no reports_to)
    const ceo = await createAgent(app, companyId, {
      name: `ceo-${randomUUID().slice(0, 6)}`,
      role: 'ceo',
    })
    ceoAgentId = ceo.id

    // Worker agent that reports to CEO
    const worker = await createAgent(app, companyId, {
      name: `worker-${randomUUID().slice(0, 6)}`,
      role: 'worker',
      reports_to: ceoAgentId,
    })
    workerAgentId = worker.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('worker agent has reports_to pointing to CEO', async () => {
    const agent = await getJson<AgentRow>(
      app,
      `/api/companies/${companyId}/agents/${workerAgentId}`,
    )
    expect(agent.reports_to).toBe(ceoAgentId)
  })

  it('creates parent issue assigned to CEO', async () => {
    const issue = await createIssue(app, companyId, {
      title: `parent-task-${randomUUID().slice(0, 6)}`,
      assignee_agent_id: ceoAgentId,
    })
    parentIssueId = issue.id
    expect(issue.assignee_agent_id).toBe(ceoAgentId)
    expect(issue.parent_id).toBeNull()
  })

  it('CEO delegates parent issue to worker — creates child issues', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${parentIssueId}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_agent_id: ceoAgentId,
        to_agent_id: workerAgentId,
        sub_tasks: [
          { title: `subtask-a-${randomUUID().slice(0, 6)}` },
          { title: `subtask-b-${randomUUID().slice(0, 6)}` },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { delegated: boolean; child_issue_ids: string[] } }
    expect(body.data.delegated).toBe(true)
    expect(body.data.child_issue_ids).toHaveLength(2)
    childIssueIds = body.data.child_issue_ids
  })

  it('child issues exist and are assigned to worker with parent_id set', async () => {
    for (const childId of childIssueIds) {
      const child = await getJson<IssueRow>(
        app,
        `/api/companies/${companyId}/issues/${childId}`,
      )
      expect(child.parent_id).toBe(parentIssueId)
      expect(child.assignee_agent_id).toBe(workerAgentId)
      expect(child.status).toBe(IssueStatus.Todo)
    }
  })

  it('delegation fails when agent does not report to delegator (wrong hierarchy)', async () => {
    // Create a second unrelated agent
    const unrelated = await createAgent(app, companyId, {
      name: `unrelated-${randomUUID().slice(0, 6)}`,
      role: 'worker',
      // reports_to: undefined — not in CEO's chain
    })

    const res = await app.request(`/api/companies/${companyId}/issues/${parentIssueId}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_agent_id: ceoAgentId,
        to_agent_id: unrelated.id,
        sub_tasks: [{ title: `subtask-${randomUUID().slice(0, 6)}` }],
      }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('does not report to')
  })

  it('completing all child issues auto-completes parent via rollup', async () => {
    // Mark both children done
    for (const childId of childIssueIds) {
      const res = await app.request(`/api/companies/${companyId}/issues/${childId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: IssueStatus.Done }),
      })
      expect(res.status).toBe(200)
    }

    // Parent should auto-complete via rollUpParentStatus
    const parent = await getJson<IssueRow>(
      app,
      `/api/companies/${companyId}/issues/${parentIssueId}`,
    )
    expect(parent.status).toBe(IssueStatus.Done)
  })

  it('cannot complete parent while a child is still incomplete', async () => {
    // Create a fresh parent + worker child for this sub-test
    const freshParent = await createIssue(app, companyId, {
      title: `incomplete-parent-${randomUUID().slice(0, 6)}`,
    })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${freshParent.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoAgentId,
          to_agent_id: workerAgentId,
          sub_tasks: [{ title: `child-${randomUUID().slice(0, 6)}` }],
        }),
      },
    )
    expect(res.status).toBe(201)

    // Attempt to complete the parent with child still in todo
    const completeRes = await app.request(
      `/api/companies/${companyId}/issues/${freshParent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: IssueStatus.Done }),
      },
    )
    expect(completeRes.status).toBe(400)
    const body = (await completeRes.json()) as { error: string }
    expect(body.error).toContain('incomplete')
  })
})

// ---------------------------------------------------------------------------
// Suite 6: Secrets Management
// ---------------------------------------------------------------------------

describe('E2E: secrets management — store → list (redacted) → get (plaintext) → delete', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app)
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  const secretName = `OPENAI_API_KEY_${randomUUID().slice(0, 6)}`
  const secretValue = `sk-test-${randomUUID()}`

  it('no secrets initially', async () => {
    const secrets = await getJson<SecretListRow[]>(app, `/api/companies/${companyId}/secrets`)
    expect(secrets).toHaveLength(0)
  })

  it('stores a secret via POST /secrets', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: secretName, value: secretValue }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { id: string; name: string } }
    expect(body.data.name).toBe(secretName)
    expect(body.data.id).toBeTruthy()
    // value must NOT be present in create response
    expect((body.data as Record<string, unknown>).value).toBeUndefined()
  })

  it('returns 409 on duplicate secret name', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: secretName, value: 'another-value' }),
    })
    expect(res.status).toBe(409)
  })

  it('lists secrets — name is visible, value is NOT returned', async () => {
    const secrets = await getJson<SecretListRow[]>(app, `/api/companies/${companyId}/secrets`)
    expect(secrets).toHaveLength(1)
    const entry = secrets[0]
    expect(entry.name).toBe(secretName)
    // The list endpoint must not leak the plaintext value
    expect((entry as Record<string, unknown>).value).toBeUndefined()
    expect((entry as Record<string, unknown>).encrypted_value).toBeUndefined()
  })

  it('retrieves decrypted secret value via GET /secrets/:name', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets/${secretName}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string; value: string } }
    expect(body.data.name).toBe(secretName)
    expect(body.data.value).toBe(secretValue)
  })

  it('returns 404 for a non-existent secret', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/secrets/NONEXISTENT_KEY_${randomUUID().slice(0, 6)}`,
    )
    expect(res.status).toBe(404)
  })

  it('stores a second secret without cross-contamination', async () => {
    const name2 = `SECOND_SECRET_${randomUUID().slice(0, 6)}`
    const value2 = `secret-${randomUUID()}`

    await app.request(`/api/companies/${companyId}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name2, value: value2 }),
    })

    const r1 = await app.request(`/api/companies/${companyId}/secrets/${secretName}`)
    const b1 = (await r1.json()) as { data: { value: string } }
    expect(b1.data.value).toBe(secretValue)

    const r2 = await app.request(`/api/companies/${companyId}/secrets/${name2}`)
    const b2 = (await r2.json()) as { data: { value: string } }
    expect(b2.data.value).toBe(value2)
  })

  it('deletes a secret via DELETE /secrets/:name', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets/${secretName}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)
  })

  it('deleted secret no longer appears in list', async () => {
    const secrets = await getJson<SecretListRow[]>(app, `/api/companies/${companyId}/secrets`)
    const found = secrets.find((s) => s.name === secretName)
    expect(found).toBeUndefined()
  })

  it('GET deleted secret returns 404', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets/${secretName}`)
    expect(res.status).toBe(404)
  })

  it('returns 400 on POST with missing name/value fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: secretName }), // missing value
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// Suite 7: Multi-Tenant Isolation
// ---------------------------------------------------------------------------

describe('E2E: multi-tenant isolation — company A cannot see company B data', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyAId: string
  let companyBId: string
  let agentAId: string
  let agentBId: string
  let issueAId: string
  let issueBId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const companyA = await createCompany(app, { name: `tenant-a-${randomUUID().slice(0, 6)}` })
    companyAId = companyA.id

    const companyB = await createCompany(app, { name: `tenant-b-${randomUUID().slice(0, 6)}` })
    companyBId = companyB.id

    const agentA = await createAgent(app, companyAId, { name: `agent-a-${randomUUID().slice(0, 6)}` })
    agentAId = agentA.id

    const agentB = await createAgent(app, companyBId, { name: `agent-b-${randomUUID().slice(0, 6)}` })
    agentBId = agentB.id

    const issueA = await createIssue(app, companyAId, { title: `issue-a-${randomUUID().slice(0, 6)}` })
    issueAId = issueA.id

    const issueB = await createIssue(app, companyBId, { title: `issue-b-${randomUUID().slice(0, 6)}` })
    issueBId = issueB.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company A GET /agents only returns company A agents', async () => {
    const agents = await getJson<AgentRow[]>(app, `/api/companies/${companyAId}/agents`)
    expect(agents.every((a) => a.company_id === companyAId)).toBe(true)
    const ids = agents.map((a) => a.id)
    expect(ids).toContain(agentAId)
    expect(ids).not.toContain(agentBId)
  })

  it('company B GET /agents only returns company B agents', async () => {
    const agents = await getJson<AgentRow[]>(app, `/api/companies/${companyBId}/agents`)
    expect(agents.every((a) => a.company_id === companyBId)).toBe(true)
    const ids = agents.map((a) => a.id)
    expect(ids).toContain(agentBId)
    expect(ids).not.toContain(agentAId)
  })

  it('company A GET /issues only returns company A issues', async () => {
    const issues = await getJson<IssueRow[]>(app, `/api/companies/${companyAId}/issues`)
    const ids = issues.map((i) => i.id)
    expect(ids).toContain(issueAId)
    expect(ids).not.toContain(issueBId)
  })

  it('company B GET /issues only returns company B issues', async () => {
    const issues = await getJson<IssueRow[]>(app, `/api/companies/${companyBId}/issues`)
    const ids = issues.map((i) => i.id)
    expect(ids).toContain(issueBId)
    expect(ids).not.toContain(issueAId)
  })

  it('company A cannot GET company B agent by id — returns 404', async () => {
    const res = await app.request(`/api/companies/${companyAId}/agents/${agentBId}`)
    expect(res.status).toBe(404)
  })

  it('company B cannot GET company A agent by id — returns 404', async () => {
    const res = await app.request(`/api/companies/${companyBId}/agents/${agentAId}`)
    expect(res.status).toBe(404)
  })

  it('company A cannot GET company B issue by id — returns 404', async () => {
    const res = await app.request(`/api/companies/${companyAId}/issues/${issueBId}`)
    expect(res.status).toBe(404)
  })

  it('company B cannot GET company A issue by id — returns 404', async () => {
    const res = await app.request(`/api/companies/${companyBId}/issues/${issueAId}`)
    expect(res.status).toBe(404)
  })

  it('policies created for company A are not visible under company B', async () => {
    await createPolicy(app, companyAId, {
      name: `iso-policy-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'github:*',
      action: PolicyAction.Allow,
      priority: 10,
    })

    const policiesB = await getJson<PolicyRow[]>(app, `/api/companies/${companyBId}/policies`)
    // All policies returned must belong to company B
    expect(policiesB.every((p) => p.company_id === companyBId)).toBe(true)
  })

  it('cost events for company A are not visible under company B', async () => {
    // Post a cost event under company A
    await app.request(`/api/companies/${companyAId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentAId,
        input_tokens: 100,
        output_tokens: 50,
        cost_cents: 25,
      }),
    })

    // Company B should see 0 cost events
    const eventsB = await getJson<unknown[]>(app, `/api/companies/${companyBId}/costs`)
    expect(eventsB).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite 8: Policy Priority Resolution
// ---------------------------------------------------------------------------

describe('E2E: policy priority resolution — highest priority wins on conflict', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app)
    companyId = company.id
    const agent = await createAgent(app, companyId)
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates 3 conflicting policies for "github:*" with different priorities', async () => {
    // Priority 100 — DENY (should win over 10 and 1)
    await createPolicy(app, companyId, {
      name: `deny-github-p100-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'github:*',
      action: PolicyAction.Deny,
      priority: 100,
      agent_id: agentId,
    })

    // Priority 10 — ALLOW (lower than deny)
    await createPolicy(app, companyId, {
      name: `allow-github-p10-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'github:*',
      action: PolicyAction.Allow,
      priority: 10,
      agent_id: agentId,
    })

    // Priority 1 — LOG (lowest)
    await createPolicy(app, companyId, {
      name: `log-github-p1-${randomUUID().slice(0, 6)}`,
      tool_pattern: 'github:*',
      action: PolicyAction.Log,
      priority: 1,
      agent_id: agentId,
    })

    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    expect(policies).toHaveLength(3)
  })

  it('policies are returned in priority DESC order by the API', async () => {
    const policies = await getJson<PolicyRow[]>(app, `/api/companies/${companyId}/policies`)
    const priorities = policies.map((p) => p.priority)
    // Each element must be >= the next
    for (let i = 0; i < priorities.length - 1; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i + 1])
    }
  })

  it('GovernanceEngine denies "github:create_repo" — priority 100 DENY wins', async () => {
    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)
    const result = await engine.checkPolicy(companyId, agentId, 'github:create_repo')
    expect(result.allowed).toBe(false)
  })

  it('GovernanceEngine allows "slack:send_message" — no matching policy, falls through to default-deny', async () => {
    // No policies match "slack:*" — should get default deny
    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)
    const result = await engine.checkPolicy(companyId, agentId, 'slack:send_message')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('default deny')
  })

  it('adding a wildcard ALLOW at priority 50 does NOT override the priority-100 DENY for github:*', async () => {
    await createPolicy(app, companyId, {
      name: `allow-all-p50-${randomUUID().slice(0, 6)}`,
      tool_pattern: '*',
      action: PolicyAction.Allow,
      priority: 50,
      agent_id: agentId,
    })

    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)

    // github:* DENY at 100 should still beat wildcard ALLOW at 50
    const githubResult = await engine.checkPolicy(companyId, agentId, 'github:delete_repo')
    expect(githubResult.allowed).toBe(false)

    // Non-github tool gets the wildcard ALLOW at priority 50 (no higher deny matches)
    const slackResult = await engine.checkPolicy(companyId, agentId, 'slack:post')
    expect(slackResult.allowed).toBe(true)
  })

  it('company-wide policy applies to other agents without their own policies', async () => {
    // Create a second agent with no agent-specific policies
    const otherAgent = await createAgent(app, companyId, {
      name: `other-agent-${randomUUID().slice(0, 6)}`,
    })

    // Create a company-wide allow-all policy (no agent_id)
    await createPolicy(app, companyId, {
      name: `company-allow-all-${randomUUID().slice(0, 6)}`,
      tool_pattern: '*',
      action: PolicyAction.Allow,
      priority: 5,
      agent_id: null,
    })

    const { GovernanceEngine } = await import('../../packages/core/src/governance/engine.js')
    const engine = new GovernanceEngine(db)

    // otherAgent has no agent-specific policy — falls back to company-wide allow
    const result = await engine.checkPolicy(companyId, otherAgent.id, 'any:tool')
    expect(result.allowed).toBe(true)
  })
})
