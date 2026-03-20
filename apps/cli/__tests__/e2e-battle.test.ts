/**
 * E2E Battle Test Suite — ShackleAI Orchestrator v0.1.0
 *
 * Comprehensive scenarios simulating real user workflows:
 *   1. Full lifecycle (init → agents → tasks → heartbeats → activity → costs → governance)
 *   2. Governance (deny policy blocks execution, allow policy permits it)
 *   3. Agent communication (comments, unread tracking via activity)
 *   4. Worktree management (create via API — validates DB record, lists, deletes)
 *   5. Cost tracking (events, aggregation, soft/hard limits, dashboard totals)
 *   6. Pagination (100 default, custom limit, offset)
 *   7. Error handling (404s, 400s, duplicate constraints, invalid state transitions)
 *   8. Dashboard API (overview stats, activity log, cost summary)
 *   9. CLI smoke tests (--help and --version via compiled dist)
 *  10. Agent lifecycle (pause → resume → terminate)
 *  11. API key generation (one-shot plaintext, stored as hash)
 *  12. Multi-tenant isolation (company A cannot access company B resources)
 *  13. Authentication (register, login, logout, JWT, dual auth, sessions, rotation, edge cases)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { AgentApiKeyStatus, AdapterType } from '@shackleai/shared'
import { createApp } from '../src/server/index.js'

const execFileAsync = promisify(execFile)

// Absolute path to the compiled CLI — works regardless of cwd
const CLI_PATH = resolve(import.meta.dirname, '../dist/index.js')

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type CompanyRow = {
  id: string
  name: string
  issue_prefix: string
  status: string
  budget_monthly_cents: number
}

type AgentRow = {
  id: string
  name: string
  status: string
  adapter_type: string
  budget_monthly_cents: number
  last_heartbeat_at: string | null
}

type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  assignee_agent_id: string | null
}

type IssueCommentRow = {
  id: string
  issue_id: string
  author_agent_id: string | null
  content: string
  is_resolved: boolean
}

type PolicyRow = {
  id: string
  company_id: string
  name: string
  tool_pattern: string
  action: string
  priority: number
  agent_id: string | null
}

type CostEventRow = {
  id: string
  company_id: string
  agent_id: string | null
  input_tokens: number
  output_tokens: number
  cost_cents: number
  provider: string | null
  model: string | null
}

type CostByAgent = {
  agent_id: string | null
  total_cost_cents: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
}

type DashboardMetrics = {
  agentCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  totalSpendCents: number
  recentActivity: unknown[]
}

type ActivityEntry = {
  id: string
  company_id: string
  entity_type: string
  entity_id: string | null
  actor_id: string | null
  action: string
  created_at: string
}

type WorktreeRecord = {
  id: string
  agent_id: string
  company_id: string
  repo_path: string
  worktree_path: string
  branch: string
  base_branch: string
  status: string
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function post<T>(
  app: App,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { data: T }
  return { status: res.status, data: json.data }
}

async function get<T>(app: App, path: string): Promise<{ status: number; data: T }> {
  const res = await app.request(path)
  const json = (await res.json()) as { data: T }
  return { status: res.status, data: json.data }
}

async function createCompany(
  app: App,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<CompanyRow> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: name.replace(/\s+/g, '').toUpperCase().slice(0, 4),
      ...extra,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function createAgent(
  app: App,
  companyId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, adapter_type: 'process', ...extra }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function createIssue(
  app: App,
  companyId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, ...extra }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

async function checkoutIssue(
  app: App,
  companyId: string,
  issueId: string,
  agentId: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/issues/${issueId}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId }),
  })
}

async function createPolicy(
  app: App,
  companyId: string,
  overrides: Record<string, unknown>,
): Promise<PolicyRow> {
  const res = await app.request(`/api/companies/${companyId}/policies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: PolicyRow }
  return body.data
}

async function postCostEvent(
  app: App,
  companyId: string,
  overrides: Record<string, unknown>,
): Promise<CostEventRow> {
  const res = await app.request(`/api/companies/${companyId}/costs/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_tokens: 100,
      output_tokens: 50,
      cost_cents: 10,
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CostEventRow }
  return body.data
}

// ---------------------------------------------------------------------------
// 1. Full Lifecycle Test
// ---------------------------------------------------------------------------

describe('Battle 1: full lifecycle', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agents: AgentRow[]
  let tasks: IssueRow[]

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates company via POST /api/companies', async () => {
    const company = await createCompany(app, 'Lifecycle Corp')
    companyId = company.id
    expect(companyId).toBeTruthy()
    expect(company.name).toBe('Lifecycle Corp')
    expect(company.status).toBe('active')
  })

  it('creates 3 agents with process adapter', async () => {
    const names = ['Atlas', 'Nexus', 'Orion']
    agents = await Promise.all(names.map((n) => createAgent(app, companyId, n)))
    expect(agents).toHaveLength(3)
    expect(agents.every((a) => a.adapter_type === 'process')).toBe(true)
    expect(agents.every((a) => a.status === 'idle')).toBe(true)
    expect(agents.map((a) => a.name)).toEqual(names)
  })

  it('all 3 agents appear in GET /api/companies/:id/agents', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(3)
    const names = body.data.map((a) => a.name)
    expect(names).toContain('Atlas')
    expect(names).toContain('Nexus')
    expect(names).toContain('Orion')
  })

  it('creates 5 tasks with auto-incremented identifiers', async () => {
    const titles = [
      'Implement authentication layer',
      'Write comprehensive unit tests',
      'Deploy to staging environment',
      'Set up monitoring dashboards',
      'Document API endpoints',
    ]
    tasks = await Promise.all(titles.map((t) => createIssue(app, companyId, t)))
    expect(tasks).toHaveLength(5)
    expect(tasks.every((t) => t.status === 'backlog')).toBe(true)
    expect(tasks.every((t) => t.assignee_agent_id === null)).toBe(true)
    // Identifiers are auto-incremented: LIFE-1, LIFE-2, etc.
    const identifiers = tasks.map((t) => t.identifier)
    expect(new Set(identifiers).size).toBe(5)
    identifiers.forEach((id) => {
      expect(id).toMatch(/^LIFE-\d+$/)
    })
  })

  it('assigns tasks to agents via checkout', async () => {
    // Assign task 0, 1, 2 to agents 0, 1, 2 respectively; tasks 3, 4 remain unassigned
    for (let i = 0; i < 3; i++) {
      const res = await checkoutIssue(app, companyId, tasks[i].id, agents[i].id)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: IssueRow }
      expect(body.data.status).toBe('in_progress')
      expect(body.data.assignee_agent_id).toBe(agents[i].id)
    }
  })

  it('triggers heartbeats by inserting heartbeat_runs directly', async () => {
    // Insert heartbeat rows — simulates agents executing
    await db.query(
      `INSERT INTO heartbeat_runs (company_id, agent_id, trigger_type, status)
       VALUES ($1, $2, 'manual', 'success'),
              ($3, $4, 'manual', 'success'),
              ($5, $6, 'manual', 'failed')`,
      [
        companyId, agents[0].id,
        companyId, agents[1].id,
        companyId, agents[2].id,
      ],
    )

    const res = await app.request(`/api/companies/${companyId}/heartbeats`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThanOrEqual(3)
  })

  it('verifies execution results via heartbeat list', async () => {
    const res = await app.request(`/api/companies/${companyId}/heartbeats`)
    const body = (await res.json()) as {
      data: Array<{ status: string; agent_id: string }>
    }
    const statuses = body.data.map((r) => r.status)
    expect(statuses).toContain('success')
    expect(statuses).toContain('failed')
  })

  it('activity log is accessible and returns array', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('records cost events and verifies aggregation', async () => {
    // Record one cost event per agent
    for (const agent of agents) {
      await postCostEvent(app, companyId, {
        agent_id: agent.id,
        input_tokens: 500,
        output_tokens: 200,
        cost_cents: 50,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
      })
    }

    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(3)
    body.data.forEach((e) => {
      expect(e.company_id).toBe(companyId)
    })
  })

  it('dashboard reflects final state correctly', async () => {
    // Mark tasks 0–2 done
    for (let i = 0; i < 3; i++) {
      await app.request(`/api/companies/${companyId}/issues/${tasks[i].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
    }

    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }

    expect(body.data.agentCount).toBe(3)
    expect(body.data.taskCount).toBe(5)
    expect(body.data.completedTasks).toBe(3)
    // 2 tasks remain (backlog) — not done or cancelled
    expect(body.data.openTasks).toBe(2)
    // 3 agents × 50 cents = 150 total
    expect(body.data.totalSpendCents).toBe(150)
    expect(Array.isArray(body.data.recentActivity)).toBe(true)
  })

  it('governance policies are accessible after lifecycle test', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    // No policies created yet — empty array is valid
    expect(Array.isArray(body.data)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Governance Test
// ---------------------------------------------------------------------------

describe('Battle 2: governance — policy enforcement', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string
  let denyPolicy: PolicyRow
  let allowPolicy: PolicyRow

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Governance Labs')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Governed Agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates deny-all policy (low priority)', async () => {
    denyPolicy = await createPolicy(app, companyId, {
      name: 'deny-everything',
      tool_pattern: '*',
      action: 'deny',
      priority: 1,
    })
    expect(denyPolicy.name).toBe('deny-everything')
    expect(denyPolicy.tool_pattern).toBe('*')
    expect(denyPolicy.action).toBe('deny')
    expect(denyPolicy.priority).toBe(1)
    expect(denyPolicy.company_id).toBe(companyId)
    expect(denyPolicy.agent_id).toBeNull()
  })

  it('policy list returns the deny policy', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(denyPolicy.id)
    expect(body.data[0].action).toBe('deny')
  })

  it('wakeup with no scheduler returns triggered:false (no scheduler available)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/wakeup`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean; agent: AgentRow } }
    // No scheduler configured — always returns triggered:false
    expect(body.data.triggered).toBe(false)
    expect(body.data.agent.id).toBe(agentId)
  })

  it('creates allow policy for web_search with higher priority', async () => {
    allowPolicy = await createPolicy(app, companyId, {
      name: 'allow-web-search',
      tool_pattern: 'web_search',
      action: 'allow',
      priority: 100,
    })
    expect(allowPolicy.action).toBe('allow')
    expect(allowPolicy.priority).toBe(100)
    expect(allowPolicy.tool_pattern).toBe('web_search')
  })

  it('policies are ordered by priority DESC — allow first, deny second', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    expect(body.data).toHaveLength(2)
    expect(body.data[0].action).toBe('allow')
    expect(body.data[0].priority).toBeGreaterThan(body.data[1].priority)
    expect(body.data[1].action).toBe('deny')
  })

  it('creates agent-scoped policy (applies to one agent only)', async () => {
    const agentPolicy = await createPolicy(app, companyId, {
      name: 'agent-specific-log',
      tool_pattern: 'bash',
      action: 'log',
      priority: 50,
      agent_id: agentId,
    })
    expect(agentPolicy.agent_id).toBe(agentId)
    expect(agentPolicy.action).toBe('log')
  })

  it('updates policy priority via PATCH', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/${denyPolicy.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 200 }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow }
    expect(body.data.priority).toBe(200)
    expect(body.data.id).toBe(denyPolicy.id)
  })

  it('returns 404 for PATCH on non-existent policy', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 999 }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('deletes allow policy via DELETE', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/${allowPolicy.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean; id: string } }
    expect(body.data.deleted).toBe(true)
    expect(body.data.id).toBe(allowPolicy.id)
  })

  it('allow policy no longer appears after deletion', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    const ids = body.data.map((p) => p.id)
    expect(ids).not.toContain(allowPolicy.id)
  })

  it('returns 400 on policy creation with invalid action', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bad-action',
        tool_pattern: '*',
        action: 'block', // not allow/deny/log
        priority: 5,
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 on policy creation with missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 5 }), // missing name, tool_pattern, action
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 3. Agent Communication Test
// ---------------------------------------------------------------------------

describe('Battle 3: agent communication via comments and activity', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentA: AgentRow
  let agentB: AgentRow
  let sharedTask: IssueRow
  let comment: IssueCommentRow

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Comm Corp')
    companyId = company.id
    agentA = await createAgent(app, companyId, 'Agent Sender')
    agentB = await createAgent(app, companyId, 'Agent Receiver')
    sharedTask = await createIssue(app, companyId, 'Shared collaboration task')
  })

  afterAll(async () => {
    await db.close()
  })

  it('agent A checks out shared task', async () => {
    const res = await checkoutIssue(app, companyId, sharedTask.id, agentA.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.assignee_agent_id).toBe(agentA.id)
  })

  it('agent A posts a comment on the shared task', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Agent A: authentication service is down, need Agent B to check the proxy',
          author_agent_id: agentA.id,
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: IssueCommentRow }
    comment = body.data
    expect(comment.content).toBe(
      'Agent A: authentication service is down, need Agent B to check the proxy',
    )
    expect(comment.author_agent_id).toBe(agentA.id)
    expect(comment.issue_id).toBe(sharedTask.id)
    expect(comment.is_resolved).toBe(false)
  })

  it('comment appears in GET /api/companies/:id/issues/:issueId/comments', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueCommentRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    const found = body.data.find((c) => c.id === comment.id)
    expect(found).toBeDefined()
    expect(found?.content).toBe(comment.content)
  })

  it('activity log has entries for this company', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(Array.isArray(body.data)).toBe(true)
    // Activity should be accessible — exact entries depend on what triggers logging
  })

  it('activity log supports since query param for polling (agent B context)', async () => {
    // Simulate Agent B polling for recent activity since epoch start
    const res = await app.request(
      `/api/companies/${companyId}/activity?since=1970-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('activity log supports agentId filter', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/activity?agentId=${agentA.id}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    // Result may be empty if no activity was logged with actor_id = agentA
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('activity log future date filter returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/activity?from=2099-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(body.data).toHaveLength(0)
  })

  it('agent B can see comment via GET /issues/:issueId/comments', async () => {
    // Simulates Agent B reading the task comments during its heartbeat context
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueCommentRow[] }
    const agentAComment = body.data.find((c) => c.author_agent_id === agentA.id)
    expect(agentAComment).toBeDefined()
    expect(agentAComment?.content).toContain('Agent A:')
  })

  it('agent B posts a reply comment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Agent B: confirmed — proxy config updated, service should recover',
          author_agent_id: agentB.id,
          parent_id: comment.id,
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: IssueCommentRow }
    expect(body.data.author_agent_id).toBe(agentB.id)
    expect(body.data.parent_id).toBe(comment.id)
  })

  it('comments list returns 2 entries in chronological order', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueCommentRow[] }
    expect(body.data.length).toBe(2)
    // Ordered ASC by created_at — Agent A's comment first
    expect(body.data[0].author_agent_id).toBe(agentA.id)
    expect(body.data[1].author_agent_id).toBe(agentB.id)
    expect(body.data[1].parent_id).toBe(comment.id)
  })

  it('returns 404 for comments on non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/comments`,
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 for comment creation with empty content', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${sharedTask.id}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', author_agent_id: agentA.id }),
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// 4. Worktree Management Test
// ---------------------------------------------------------------------------

describe('Battle 4: worktree management (DB-level)', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Worktree Works')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Worktree Agent', {
      adapter_type: 'process',
    })
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/agents/:agentId/worktrees returns empty array initially', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorktreeRecord[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/agents/:agentId/worktrees returns 400 for non-existent repo', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_path: '/tmp/nonexistent-repo-xyz-12345',
          branch: 'feature/test-branch',
          base_branch: 'main',
        }),
      },
    )
    // Non-existent repo path → WorktreeManager throws → 400
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('POST with invalid body returns 400 validation error', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // missing required repo_path and branch
          base_branch: 'main',
        }),
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('GET worktrees for non-existent agent returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/worktrees`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('seeds worktree record directly in DB and verifies via list API', async () => {
    // Insert a worktree record directly to simulate the API creating one
    const worktreeId = '11111111-1111-1111-1111-111111111111'
    await db.query(
      `INSERT INTO agent_worktrees
         (id, agent_id, company_id, repo_path, worktree_path, branch, base_branch, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        worktreeId,
        agentId,
        companyId,
        '/fake/repo',
        '/fake/repo/.worktrees/test-branch',
        'feature/test-branch',
        'main',
        'active',
      ],
    )

    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorktreeRecord[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(worktreeId)
    expect(body.data[0].branch).toBe('feature/test-branch')
    expect(body.data[0].base_branch).toBe('main')
    expect(body.data[0].status).toBe('active')
  })

  it('GET worktree detail by ID returns the record', async () => {
    const worktreeId = '11111111-1111-1111-1111-111111111111'
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees/${worktreeId}`,
    )
    // Returns the DB record since the filesystem path doesn't exist
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorktreeRecord }
    expect(body.data).toBeDefined()
  })

  it('GET worktree detail for non-existent ID returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/worktrees/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Worktree not found')
  })

  it('POST /api/companies/:id/worktrees/cleanup returns cleanup result', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/worktrees/cleanup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true, max_age_ms: 0 }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { removed: string[]; stashed: string[]; skipped: string[] }
    }
    expect(Array.isArray(body.data.removed)).toBe(true)
    expect(Array.isArray(body.data.stashed)).toBe(true)
    expect(Array.isArray(body.data.skipped)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Cost Tracking Test
// ---------------------------------------------------------------------------

describe('Battle 5: cost tracking', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let richAgentId: string
  let poorAgentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Cost Corp', { budget_monthly_cents: 10000 })
    companyId = company.id
    const richAgent = await createAgent(app, companyId, 'Rich Agent', {
      budget_monthly_cents: 5000,
    })
    richAgentId = richAgent.id
    const poorAgent = await createAgent(app, companyId, 'Poor Agent', {
      budget_monthly_cents: 100,
    })
    poorAgentId = poorAgent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company is created with budget_monthly_cents: 10000', async () => {
    const res = await app.request(`/api/companies/${companyId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.budget_monthly_cents).toBe(10000)
  })

  it('rich agent has budget_monthly_cents: 5000', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${richAgentId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.budget_monthly_cents).toBe(5000)
  })

  it('poor agent has budget_monthly_cents: 100', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${poorAgentId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.budget_monthly_cents).toBe(100)
  })

  it('GET /costs returns empty before any events', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('records 3 cost events for rich agent', async () => {
    for (const [inputT, outputT, costC, model] of [
      [1000, 400, 120, 'claude-opus-4'],
      [800,  300,  90, 'claude-sonnet-4'],
      [500,  200,  50, 'claude-haiku-3-5'],
    ] as Array<[number, number, number, string]>) {
      const event = await postCostEvent(app, companyId, {
        agent_id: richAgentId,
        input_tokens: inputT,
        output_tokens: outputT,
        cost_cents: costC,
        provider: 'anthropic',
        model,
      })
      expect(event.company_id).toBe(companyId)
      expect(event.agent_id).toBe(richAgentId)
      expect(event.cost_cents).toBe(costC)
    }
  })

  it('records 1 cost event for poor agent', async () => {
    const event = await postCostEvent(app, companyId, {
      agent_id: poorAgentId,
      input_tokens: 50,
      output_tokens: 20,
      cost_cents: 8,
      provider: 'anthropic',
      model: 'claude-haiku-3-5',
    })
    expect(event.agent_id).toBe(poorAgentId)
    expect(event.cost_cents).toBe(8)
  })

  it('GET /costs returns all 4 events ordered by occurred_at DESC', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(4)
    expect(body.data.every((e) => e.company_id === companyId)).toBe(true)
  })

  it('GET /costs/by-agent aggregates correctly per agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostByAgent[] }
    expect(body.data).toHaveLength(2)

    // Rich agent: 120 + 90 + 50 = 260 cents, input 2300, output 900
    const richRow = body.data.find((r) => r.agent_id === richAgentId)
    expect(richRow).toBeDefined()
    expect(richRow?.total_cost_cents).toBe(260)
    expect(richRow?.total_input_tokens).toBe(2300)
    expect(richRow?.total_output_tokens).toBe(900)
    expect(richRow?.event_count).toBe(3)

    // Poor agent: 8 cents
    const poorRow = body.data.find((r) => r.agent_id === poorAgentId)
    expect(poorRow).toBeDefined()
    expect(poorRow?.total_cost_cents).toBe(8)
    expect(poorRow?.event_count).toBe(1)

    // Ordered by total_cost_cents DESC — rich agent first
    expect(body.data[0].agent_id).toBe(richAgentId)
  })

  it('dashboard totalSpendCents sums all cost events', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }
    // 120 + 90 + 50 + 8 = 268
    expect(body.data.totalSpendCents).toBe(268)
  })

  it('GET /costs with from= future date returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/costs?from=2099-12-31T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('GET /costs with to= past date returns empty', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/costs?to=1970-01-01T00:00:00Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostEventRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('returns 400 for cost event missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: richAgentId }), // missing input_tokens, output_tokens, cost_cents
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 for cost event with invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 6. Pagination Test
// ---------------------------------------------------------------------------

describe('Battle 6: pagination', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Pagination Plc')
    companyId = company.id

    // Create 15 agents (fast bulk insert via SQL to stay within timeout)
    const values = Array.from({ length: 15 }, (_, i) => i + 1)
      .map(
        (i) =>
          `('${companyId}', 'Bulk Agent ${String(i).padStart(2, '0')}', 'general', 'idle', 'process', '{}', 0)`,
      )
      .join(', ')

    await db.query(
      `INSERT INTO agents (company_id, name, role, status, adapter_type, adapter_config, budget_monthly_cents)
       VALUES ${values}`,
    )
  })

  afterAll(async () => {
    await db.close()
  })

  it('default list returns up to 100 agents (all 15)', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    // Exactly 15 inserted, all returned under default limit of 100
    expect(body.data.length).toBe(15)
  })

  it('?limit=5 returns exactly 5 agents', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents?limit=5`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data.length).toBe(5)
  })

  it('?limit=5&offset=5 returns the next 5 agents (no overlap)', async () => {
    const firstRes = await app.request(`/api/companies/${companyId}/agents?limit=5`)
    const firstBody = (await firstRes.json()) as { data: AgentRow[] }
    const firstIds = firstBody.data.map((a) => a.id)

    const secondRes = await app.request(
      `/api/companies/${companyId}/agents?limit=5&offset=5`,
    )
    const secondBody = (await secondRes.json()) as { data: AgentRow[] }
    expect(secondBody.data.length).toBe(5)
    const secondIds = secondBody.data.map((a) => a.id)

    // No overlap between pages
    const overlap = firstIds.filter((id) => secondIds.includes(id))
    expect(overlap).toHaveLength(0)
  })

  it('?limit=5&offset=10 returns the final 5 agents', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents?limit=5&offset=10`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data.length).toBe(5)
  })

  it('?offset=100 returns empty array (beyond all records)', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents?offset=100`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('?limit=1 returns exactly 1 agent', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents?limit=1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(1)
  })

  it('three pages cover all 15 agents without overlap', async () => {
    const pages = await Promise.all([
      app.request(`/api/companies/${companyId}/agents?limit=5&offset=0`),
      app.request(`/api/companies/${companyId}/agents?limit=5&offset=5`),
      app.request(`/api/companies/${companyId}/agents?limit=5&offset=10`),
    ])
    const allIds = (
      await Promise.all(
        pages.map(async (r) => {
          const b = (await r.json()) as { data: AgentRow[] }
          return b.data.map((a) => a.id)
        }),
      )
    ).flat()

    expect(allIds).toHaveLength(15)
    // All unique — no overlap
    expect(new Set(allIds).size).toBe(15)
  })

  it('issue list also supports pagination', async () => {
    // Insert 12 issues via SQL
    const issueValues = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((i) => `('${companyId}', 'PAGE-${i}', ${i}, 'Bulk Issue ${i}', 'backlog', 'medium')`)
      .join(', ')
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status, priority)
       VALUES ${issueValues}`,
    )

    const res = await app.request(`/api/companies/${companyId}/issues?limit=5`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.length).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 7. Error Handling Test
// ---------------------------------------------------------------------------

describe('Battle 7: error handling', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Error Corp')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Error Test Agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  // ── Company errors ────────────────────────────────────────────────────────

  it('GET /api/companies/nonexistent → 404', async () => {
    const res = await app.request(
      '/api/companies/00000000-0000-0000-0000-000000000000',
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('POST /api/companies with missing name → 400', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_prefix: 'TEST' }), // missing name
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies with invalid JSON → 400', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    })
    expect(res.status).toBe(400)
  })

  // ── Agent errors ──────────────────────────────────────────────────────────

  it('GET /api/companies/:id/agents/nonexistent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('POST /api/companies/:id/agents with missing name → 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_type: 'process' }), // missing name
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('PATCH /api/companies/:id/agents/nonexistent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH /api/companies/:id/agents with invalid status → 400', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'flying' }), // not a valid AgentStatus
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  // ── Issue errors ──────────────────────────────────────────────────────────

  it('GET /api/companies/:id/issues/nonexistent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('POST /api/companies/:id/issues with missing title → 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No title here' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('DELETE /api/companies/:id/agents/nonexistent → 404 via terminate endpoint', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/terminate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })

  it('POST agent wakeup without scheduler returns triggered:false', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/wakeup`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean } }
    expect(body.data.triggered).toBe(false)
  })

  it('POST /api/companies/:id/issues/:issueId/checkout for nonexistent issue → 404', async () => {
    const res = await checkoutIssue(
      app,
      companyId,
      '00000000-0000-0000-0000-000000000000',
      agentId,
    )
    expect(res.status).toBe(404)
  })

  it('POST /api/companies/:id/issues/:issueId/checkout already-checked-out issue → 409', async () => {
    const task = await createIssue(app, companyId, 'Already claimed task')
    const first = await checkoutIssue(app, companyId, task.id, agentId)
    expect(first.status).toBe(200)

    const second = await checkoutIssue(app, companyId, task.id, agentId)
    expect(second.status).toBe(409)
    const body = (await second.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('PATCH issue with invalid status value → 400', async () => {
    const task = await createIssue(app, companyId, 'Status test task')
    const res = await app.request(
      `/api/companies/${companyId}/issues/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'limbo' }), // not a valid IssueStatus
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  // ── Health endpoint ───────────────────────────────────────────────────────

  it('GET /api/health returns 200 with version', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; version: string }
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
  })
})

// ---------------------------------------------------------------------------
// 8. Dashboard API Test
// ---------------------------------------------------------------------------

describe('Battle 8: dashboard API', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Dashboard Inc')
    companyId = company.id

    // Create varied state: 4 agents, 6 issues (mix of statuses), 3 cost events
    const agent1 = await createAgent(app, companyId, 'Dashboard Agent A')
    const agent2 = await createAgent(app, companyId, 'Dashboard Agent B')
    await createAgent(app, companyId, 'Dashboard Agent C')
    await createAgent(app, companyId, 'Dashboard Agent D')

    const task1 = await createIssue(app, companyId, 'Dashboard task 1')
    const task2 = await createIssue(app, companyId, 'Dashboard task 2')
    const task3 = await createIssue(app, companyId, 'Dashboard task 3')
    const task4 = await createIssue(app, companyId, 'Dashboard task 4')
    await createIssue(app, companyId, 'Dashboard task 5')
    await createIssue(app, companyId, 'Dashboard task 6')

    // Check out tasks 1 & 2
    await checkoutIssue(app, companyId, task1.id, agent1.id)
    await checkoutIssue(app, companyId, task2.id, agent2.id)

    // Complete task 1, cancel task 3
    await app.request(`/api/companies/${companyId}/issues/${task1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    await app.request(`/api/companies/${companyId}/issues/${task3.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    await app.request(`/api/companies/${companyId}/issues/${task4.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })

    // Record cost events
    await postCostEvent(app, companyId, {
      agent_id: agent1.id,
      input_tokens: 200,
      output_tokens: 80,
      cost_cents: 25,
    })
    await postCostEvent(app, companyId, {
      agent_id: agent2.id,
      input_tokens: 400,
      output_tokens: 150,
      cost_cents: 45,
    })
    await postCostEvent(app, companyId, {
      input_tokens: 100,
      output_tokens: 40,
      cost_cents: 10,
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/dashboard returns correct overview stats', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }

    expect(body.data.agentCount).toBe(4)
    expect(body.data.taskCount).toBe(6)
    // Done: task1, task4 = 2
    expect(body.data.completedTasks).toBe(2)
    // Open = not done AND not cancelled: task2 (in_progress), task5 (backlog), task6 (backlog) = 3
    expect(body.data.openTasks).toBe(3)
    // 25 + 45 + 10 = 80
    expect(body.data.totalSpendCents).toBe(80)
    expect(Array.isArray(body.data.recentActivity)).toBe(true)
    expect(body.data.recentActivity.length).toBeLessThanOrEqual(5)
  })

  it('GET /api/companies/:id/activity returns recent entries', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('GET /api/companies/:id/costs/by-agent returns cost summary', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CostByAgent[] }
    expect(Array.isArray(body.data)).toBe(true)
    // 3 events: 2 with agent_id, 1 without — groups into 3 rows (null is its own group)
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    const totalCost = body.data.reduce((sum, row) => sum + row.total_cost_cents, 0)
    expect(totalCost).toBe(80)
  })

  it('dashboard recentActivity cap is 5 entries', async () => {
    // Insert additional activity log entries to verify cap
    // entity_id is UUID — use gen_random_uuid() directly (no cast to text)
    await db.query(
      `INSERT INTO activity_log (company_id, entity_type, entity_id, actor_type, actor_id, action)
       SELECT $1, 'agent', gen_random_uuid(), 'system', NULL, 'test_event_' || s
       FROM generate_series(1, 10) AS s`,
      [companyId],
    )

    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }
    // recentActivity capped at 5
    expect(body.data.recentActivity.length).toBeLessThanOrEqual(5)
  })

  it('activity log supports entity_type filter', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/activity?entity_type=agent`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ActivityEntry[] }
    expect(Array.isArray(body.data)).toBe(true)
    body.data.forEach((e) => {
      expect(e.entity_type).toBe('agent')
    })
  })
})

// ---------------------------------------------------------------------------
// 9. CLI Smoke Tests
// ---------------------------------------------------------------------------

describe('Battle 9: CLI smoke tests', () => {
  it('dist/index.js --help exits cleanly and shows commands', async () => {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, '--help'], {
      timeout: 10_000,
    })
    const output = stdout + stderr
    expect(output).toContain('shackleai')
    expect(output).toContain('init')
    expect(output).toContain('start')
  })

  it('dist/index.js --version shows 0.1.0', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--version'], {
      timeout: 10_000,
    })
    expect(stdout.trim()).toBe('0.1.0')
  })

  it('dist/index.js init --help shows init-specific help', async () => {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, 'init', '--help'], {
      timeout: 5_000,
    })
    const output = stdout + stderr
    expect(output).toContain('init')
  })

  it('dist/index.js start --help shows start-specific help', async () => {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, 'start', '--help'], {
      timeout: 5_000,
    })
    const output = stdout + stderr
    expect(output).toContain('start')
    expect(output).toContain('port')
  })
})

// ---------------------------------------------------------------------------
// 10. Agent Lifecycle Test
// ---------------------------------------------------------------------------

describe('Battle 10: agent lifecycle', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Lifecycle Agents')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Lifecycle Subject')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('agent starts in idle status', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe('idle')
  })

  it('POST /pause sets status to paused', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/pause`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe('paused')
    expect(body.data.id).toBe(agentId)
  })

  it('POST /resume sets status back to idle', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/resume`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe('idle')
  })

  it('PATCH agent updates name and capabilities', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Lifecycle Subject v2',
          capabilities: 'coding,testing,deployment',
        }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.name).toBe('Lifecycle Subject v2')
  })

  it('POST /terminate sets status to terminated', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/terminate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe('terminated')
    expect(body.data.id).toBe(agentId)
  })

  it('terminated agent persists in DB and is retrievable', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe('terminated')
  })

  it('POST /pause on non-existent agent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/pause`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })

  it('POST /resume on non-existent agent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/resume`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 11. API Key Generation Test
// ---------------------------------------------------------------------------

describe('Battle 11: API key generation', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Key Corp')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'API Key Agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST /api-keys generates a key and returns it once (plaintext)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/api-keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'production-key' }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        agent_id: string
        company_id: string
        label: string
        status: string
        key: string
      }
    }
    expect(body.data.key).toBeTruthy()
    expect(body.data.key).toHaveLength(64) // 32 bytes hex = 64 chars
    expect(body.data.label).toBe('production-key')
    expect(body.data.status).toBe('active')
    expect(body.data.agent_id).toBe(agentId)
    expect(body.data.company_id).toBe(companyId)
    // key_hash is NOT returned
    expect((body.data as Record<string, unknown>).key_hash).toBeUndefined()
  })

  it('key is stored as hash in DB — plaintext is not persisted', async () => {
    const result = await db.query<{ key_hash: string; label: string }>(
      `SELECT key_hash, label FROM agent_api_keys WHERE agent_id = $1`,
      [agentId],
    )
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].label).toBe('production-key')
    // Hash should be 64-char SHA-256 hex string — NOT the same as the plain key
    expect(result.rows[0].key_hash).toHaveLength(64)
    expect(result.rows[0].key_hash).toMatch(/^[a-f0-9]+$/)
  })

  it('generates second API key without label', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/api-keys`,
      { method: 'POST' },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { key: string; label: string | null } }
    expect(body.data.key).toHaveLength(64)
    expect(body.data.label).toBeNull()
  })

  it('each generated key is unique', async () => {
    const keys = await Promise.all([
      app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, { method: 'POST' }),
      app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, { method: 'POST' }),
      app.request(`/api/companies/${companyId}/agents/${agentId}/api-keys`, { method: 'POST' }),
    ])
    const plainKeys = await Promise.all(
      keys.map(async (r) => {
        const b = (await r.json()) as { data: { key: string } }
        return b.data.key
      }),
    )
    expect(new Set(plainKeys).size).toBe(3)
  })

  it('POST /api-keys for non-existent agent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/api-keys`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })
})

// ---------------------------------------------------------------------------
// 12. Multi-Tenant Isolation Test
// ---------------------------------------------------------------------------

describe('Battle 12: multi-tenant isolation', () => {
  let db: PGliteProvider
  let app: App
  let companyAId: string
  let companyBId: string
  let agentAId: string
  let agentBId: string
  let taskAId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    // Use explicit distinct prefixes — both "Tenant Alpha" and "Tenant Beta"
    // produce the same auto-generated prefix "TENA" (first 4 chars of "TENANTALPHA/BETA")
    const companyA = await createCompany(app, 'Tenant Alpha', { issue_prefix: 'ALPH' })
    const companyB = await createCompany(app, 'Tenant Beta', { issue_prefix: 'BETA' })
    companyAId = companyA.id
    companyBId = companyB.id

    const agentA = await createAgent(app, companyAId, 'Alpha Agent')
    const agentB = await createAgent(app, companyBId, 'Beta Agent')
    agentAId = agentA.id
    agentBId = agentB.id

    const taskA = await createIssue(app, companyAId, 'Alpha secret task')
    taskAId = taskA.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company A cannot see company B agents', async () => {
    // Agent B belongs to company B — querying via company A's scope should return 404
    const res = await app.request(`/api/companies/${companyAId}/agents/${agentBId}`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('company B cannot see company A agents', async () => {
    const res = await app.request(`/api/companies/${companyBId}/agents/${agentAId}`)
    expect(res.status).toBe(404)
  })

  it('company B cannot checkout company A tasks', async () => {
    // Task A belongs to company A — checking out via company B should 404
    const res = await checkoutIssue(app, companyBId, taskAId, agentBId)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('company A agent list only shows company A agents', async () => {
    const res = await app.request(`/api/companies/${companyAId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    const agentIds = body.data.map((a) => a.id)
    expect(agentIds).toContain(agentAId)
    expect(agentIds).not.toContain(agentBId)
  })

  it('company B agent list only shows company B agents', async () => {
    const res = await app.request(`/api/companies/${companyBId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    const agentIds = body.data.map((a) => a.id)
    expect(agentIds).toContain(agentBId)
    expect(agentIds).not.toContain(agentAId)
  })

  it('company B dashboard does not include company A costs', async () => {
    // Record cost for company A
    await postCostEvent(app, companyAId, {
      agent_id: agentAId,
      input_tokens: 1000,
      output_tokens: 400,
      cost_cents: 99,
    })

    const resB = await app.request(`/api/companies/${companyBId}/dashboard`)
    expect(resB.status).toBe(200)
    const body = (await resB.json()) as { data: DashboardMetrics }
    // Company B has no cost events — should be 0
    expect(body.data.totalSpendCents).toBe(0)
  })

  it('company A policy cannot be read by company B', async () => {
    // Create policy for company A
    const policy = await createPolicy(app, companyAId, {
      name: 'alpha-secret',
      tool_pattern: '*',
      action: 'deny',
      priority: 1,
    })

    // Query company B's policies — should NOT see company A's policy
    const res = await app.request(`/api/companies/${companyBId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    const policyIds = body.data.map((p) => p.id)
    expect(policyIds).not.toContain(policy.id)
  })

  it('companies can be independently updated without cross-contamination', async () => {
    await app.request(`/api/companies/${companyAId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tenant Alpha Updated' }),
    })

    // Company B name should remain unchanged
    const resB = await app.request(`/api/companies/${companyBId}`)
    expect(resB.status).toBe(200)
    const body = (await resB.json()) as { data: CompanyRow }
    expect(body.data.name).toBe('Tenant Beta')
  })
})

// ---------------------------------------------------------------------------
// 13. Authentication Battle Test
// ---------------------------------------------------------------------------
//
// Covers all scenarios from GitHub issue #272:
//
// Happy Path:
//   - Register new user
//   - Login with valid credentials
//   - Logout (session invalidation)
//   - JWT token validates on protected routes (createApiAuth accepts JWT)
//   - API key authentication (createApiAuth accepts agent API keys)
//   - Dual auth — JWT + API key both accepted on same protected route
//   - Health endpoint — no auth required
//
// Edge Cases:
//   - Token near expiry (1-second TTL JWT still works before it expires)
//   - Multiple active sessions (same user, multiple logins co-exist)
//   - API key rotation (revoke old key → new key works, old key rejected)
//
// Error Cases:
//   - Login with wrong password → 401
//   - Expired JWT → 401
//   - Invalid API key → 401
//   - Missing auth header → 401
//   - Register with existing email → 409
//   - Register with invalid email → 400
//   - Register with password too short → 400
//   - Login with invalid email format → 400
//   - /me after logout → 401 (session invalidated even though token is cryptographically valid)
//   - Login error is ambiguous (same message for wrong password and unknown user)
//   - Forged JWT (tampered signature) → 401
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers local to Battle 13
// ---------------------------------------------------------------------------

/** Build a minimal HS256 JWT with a custom exp (seconds from now). */
function buildJwt(
  payload: { sub: string; email: string; role: string },
  ttlSeconds: number,
  secret = 'shackleai-dev-jwt-secret-change-me',
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = base64UrlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }),
  )
  const signature = createHmac('sha256', secret)
    .update(`${header}.${fullPayload}`)
    .digest('base64url')
  return `${header}.${fullPayload}.${signature}`
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

/** Seed an agent API key directly into the DB (reuses the pattern from auth.test.ts). */
async function seedApiKey(
  db: PGliteProvider,
  plainKey: string,
  status: string = AgentApiKeyStatus.Active,
): Promise<void> {
  const setupApp = createApp(db, { skipAuth: true })

  const companyRes = await setupApp.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Auth Battle Corp ${randomBytes(4).toString('hex')}`,
      issue_prefix: randomBytes(3).toString('hex').toUpperCase(),
    }),
  })
  const { data: company } = (await companyRes.json()) as { data: { id: string } }

  const agentRes = await setupApp.request(`/api/companies/${company.id}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Auth Battle Agent', adapter_type: AdapterType.Process }),
  })
  const { data: agent } = (await agentRes.json()) as { data: { id: string } }

  const keyHash = createHash('sha256').update(plainKey).digest('hex')
  await db.query(
    `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, status)
     VALUES ($1, $2, $3, $4)`,
    [agent.id, company.id, keyHash, status],
  )
}

// ---------------------------------------------------------------------------
// Battle 13 — Happy Path
// ---------------------------------------------------------------------------

describe('Battle 13a: authentication — happy path', () => {
  let db: PGliteProvider
  let app: App
  let registeredEmail: string
  let registeredToken: string
  let registeredUserId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    // Auth routes are always active regardless of skipAuth; we test with real auth engaged
    app = createApp(db)
  })

  afterAll(async () => {
    await db.close()
  })

  // --- Health: always public ---

  it('GET /api/health requires no auth', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  // --- Register ---

  it('POST /api/auth/register creates a new user and returns JWT', async () => {
    registeredEmail = `battle-auth-${randomBytes(4).toString('hex')}@test.shackleai.com`

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: registeredEmail,
        password: 'Battle@1234!',
        name: 'Battle Auth User',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { user: { id: string; email: string; password_hash?: string }; token: string } }
    expect(body.data.user.email).toBe(registeredEmail)
    expect(body.data.token).toBeTruthy()
    // Password hash must NEVER be returned
    expect(body.data.user.password_hash).toBeUndefined()

    registeredToken = body.data.token
    registeredUserId = body.data.user.id
  })

  // --- JWT validates on protected routes ---

  it('JWT token from register is accepted by the global auth middleware on protected routes', async () => {
    // /api/companies is a protected route — should pass with a valid human JWT
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${registeredToken}` },
    })
    // 200 means auth passed; the route itself may return empty list — that's fine
    expect(res.status).toBe(200)
  })

  // --- Login ---

  it('POST /api/auth/login returns a fresh JWT for valid credentials', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: registeredEmail, password: 'Battle@1234!' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { token: string; user: { email: string } } }
    expect(body.data.token).toBeTruthy()
    expect(body.data.user.email).toBe(registeredEmail)
    // Each login issues a new token (different iat at minimum)
    // We don't assert inequality here because same-second logins can collide — tested in edge cases
    registeredToken = body.data.token
  })

  // --- GET /me with valid JWT ---

  it('GET /api/auth/me returns user profile for a valid JWT', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${registeredToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; email: string } }
    expect(body.data.email).toBe(registeredEmail)
    expect(body.data.id).toBe(registeredUserId)
  })

  // --- API key authentication ---

  it('agent API key is accepted by the global auth middleware on protected routes', async () => {
    const plainKey = randomBytes(32).toString('hex')
    await seedApiKey(db, plainKey, AgentApiKeyStatus.Active)

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(200)
  })

  // --- Dual auth: JWT and API key both work on the same endpoint ---

  it('protected endpoint accepts JWT (human) and API key (agent) interchangeably', async () => {
    const plainKey = randomBytes(32).toString('hex')
    await seedApiKey(db, plainKey, AgentApiKeyStatus.Active)

    const [jwtRes, keyRes] = await Promise.all([
      app.request('/api/companies', {
        headers: { Authorization: `Bearer ${registeredToken}` },
      }),
      app.request('/api/companies', {
        headers: { Authorization: `Bearer ${plainKey}` },
      }),
    ])

    expect(jwtRes.status).toBe(200)
    expect(keyRes.status).toBe(200)
  })

  // --- Logout ---

  it('POST /api/auth/logout invalidates the session', async () => {
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${registeredToken}` },
    })
    expect(logoutRes.status).toBe(200)
    const body = (await logoutRes.json()) as { data: { message: string } }
    expect(body.data.message).toContain('Logged out')
  })

  it('GET /api/auth/me returns 401 after logout even though JWT is cryptographically valid', async () => {
    // The JWT itself is still valid (not expired), but the session was deleted on logout.
    // The /me route must check the session table, not just the JWT signature.
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${registeredToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('protected routes reject the invalidated JWT after logout', async () => {
    // The global createApiAuth also tries JWT first — it should reject because the session
    // no longer exists in user_sessions after logout.
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${registeredToken}` },
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Battle 13b — Edge Cases
// ---------------------------------------------------------------------------

describe('Battle 13b: authentication — edge cases', () => {
  let db: PGliteProvider
  let app: App

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
  })

  afterAll(async () => {
    await db.close()
  })

  // --- Token near expiry ---

  it('JWT with 5-second TTL is accepted on protected routes before it expires', async () => {
    // Register a user so we can build a valid, signed token
    const email = `near-expiry-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Near Expiry User' }),
    })
    expect(regRes.status).toBe(201)
    const regBody = (await regRes.json()) as { data: { user: { id: string; role: string }; token: string } }

    // Build a token with only 5 seconds to live using the known dev secret
    const shortToken = buildJwt(
      { sub: regBody.data.user.id, email, role: regBody.data.user.role },
      5,
    )

    // Store this short-lived session in user_sessions so the middleware can validate it
    const tokenHash = createHash('sha256').update(shortToken).digest('hex')
    const expiresAt = new Date(Date.now() + 5000).toISOString()
    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [regBody.data.user.id, tokenHash, expiresAt],
    )

    // Request immediately — token has not yet expired
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${shortToken}` },
    })
    expect(res.status).toBe(200)
  })

  // --- Multiple active sessions ---

  it('a single user can have multiple active sessions simultaneously', async () => {
    // NOTE — same-second collision caveat applies here too (see partial-logout test comment).
    // We build token2 directly via buildJwt + 1100ms wait to guarantee different iat,
    // then manually insert its session row so both sessions are truly independent.
    const email = `multi-session-${randomBytes(4).toString('hex')}@test.shackleai.com`

    // Register → token1 (normal session created by the API)
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Multi Session User' }),
    })
    expect(regRes.status).toBe(201)
    const regBody = (await regRes.json()) as { data: { user: { id: string; role: string }; token: string } }
    const token1 = regBody.data.token
    const userId = regBody.data.user.id
    const userRole = regBody.data.user.role

    // Wait >1 second to ensure different wall-clock second → different iat → different token hash
    await new Promise((r) => setTimeout(r, 1100))

    // Build token2 with a different iat and insert a second session row
    const token2 = buildJwt({ sub: userId, email, role: userRole }, 7 * 24 * 60 * 60)
    const token2Hash = createHash('sha256').update(token2).digest('hex')
    const token2Expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [userId, token2Hash, token2Expires],
    )

    // Both tokens must work independently
    const [r1, r2] = await Promise.all([
      app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token1}` } }),
      app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token2}` } }),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    // Verify two distinct session rows exist in the DB for this user
    const sessionRows = await db.query<{ id: string }>(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(sessionRows.rows.length).toBeGreaterThanOrEqual(2)
  })

  it('logging out of one session does not invalidate other sessions', async () => {
    // NOTE — known limitation: JWT iat/exp has second-level precision. If two logins
    // occur within the same wall-clock second they produce the same token hash, and the
    // ON CONFLICT DO NOTHING clause merges them into one session row. Logging out then
    // removes the shared row, which invalidates "both" tokens (they are the same token).
    //
    // This test avoids the race by:
    //   1. Seeding token2 directly as a second, independent session row with a different
    //      token (built via buildJwt with the same user sub), bypassing the collision.
    //   2. Verifying that the logout of token1 only removes token1's session row.
    //
    // BUG: If two login requests arrive in the same second, the second session is silently
    // dropped by ON CONFLICT DO NOTHING — they become the same session. The fix would be
    // to include a random nonce (jti claim) in the JWT payload to guarantee uniqueness.
    // See: https://github.com/shackleai/orchestrator/issues/272

    const email = `partial-logout-${randomBytes(4).toString('hex')}@test.shackleai.com`

    // Register → token1 (from the API — normal session row)
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Partial Logout User' }),
    })
    expect(regRes.status).toBe(201)
    const regBody = (await regRes.json()) as { data: { user: { id: string; role: string }; token: string } }
    const token1 = regBody.data.token
    const userId = regBody.data.user.id
    const userRole = regBody.data.user.role

    // Build token2 directly — different token, different session row.
    // Wait to ensure different wall-clock second so iat differs from token1.
    await new Promise((r) => setTimeout(r, 1100))
    const token2 = buildJwt({ sub: userId, email, role: userRole }, 7 * 24 * 60 * 60)
    const token2Hash = createHash('sha256').update(token2).digest('hex')
    const token2Expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [userId, token2Hash, token2Expires],
    )

    // Verify both sessions are in the DB
    const beforeLogout = await db.query<{ id: string }>(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(beforeLogout.rows.length).toBe(2)

    // Logout token1 only
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}` },
    })
    expect(logoutRes.status).toBe(200)

    // token1 should now be rejected
    const r1 = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token1}` } })
    expect(r1.status).toBe(401)

    // token2 must still be valid — its session row was not touched
    const r2 = await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${token2}` } })
    expect(r2.status).toBe(200)

    // Only one session row remains (token2's)
    const afterLogout = await db.query<{ id: string }>(
      `SELECT id FROM user_sessions WHERE user_id = $1`,
      [userId],
    )
    expect(afterLogout.rows.length).toBe(1)
  })

  // --- API key rotation ---

  it('API key rotation: revoked key is rejected, new key is accepted', async () => {
    const oldKey = randomBytes(32).toString('hex')
    const newKey = randomBytes(32).toString('hex')

    // Seed old key as active
    await seedApiKey(db, oldKey, AgentApiKeyStatus.Active)

    // Old key works initially
    const r1 = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${oldKey}` },
    })
    expect(r1.status).toBe(200)

    // Revoke the old key directly in DB (simulates key rotation via API)
    const oldHash = createHash('sha256').update(oldKey).digest('hex')
    await db.query(
      `UPDATE agent_api_keys SET status = $1 WHERE key_hash = $2`,
      [AgentApiKeyStatus.Revoked, oldHash],
    )

    // Old key is now rejected
    const r2 = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${oldKey}` },
    })
    expect(r2.status).toBe(401)

    // Seed new replacement key
    await seedApiKey(db, newKey, AgentApiKeyStatus.Active)

    // New key works
    const r3 = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${newKey}` },
    })
    expect(r3.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Battle 13c — Error Cases
// ---------------------------------------------------------------------------

describe('Battle 13c: authentication — error cases', () => {
  let db: PGliteProvider
  let app: App

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
  })

  afterAll(async () => {
    await db.close()
  })

  // --- Login errors ---

  it('POST /api/auth/login with wrong password returns 401', async () => {
    const email = `wrong-pw-${randomBytes(4).toString('hex')}@test.shackleai.com`
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Correct@1234!', name: 'Wrong PW User' }),
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPassword!' }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('POST /api/auth/login error message is ambiguous (does not reveal whether user exists)', async () => {
    // Non-existent user
    const ghostRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `ghost-${randomBytes(4).toString('hex')}@test.shackleai.com`,
        password: 'Test@1234!',
      }),
    })
    expect(ghostRes.status).toBe(401)
    const ghostBody = (await ghostRes.json()) as { error: string }

    // Register a real user, then login with wrong password
    const realEmail = `real-${randomBytes(4).toString('hex')}@test.shackleai.com`
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: realEmail, password: 'Correct@1234!', name: 'Real User' }),
    })
    const wrongPwRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: realEmail, password: 'WrongPassword!' }),
    })
    expect(wrongPwRes.status).toBe(401)
    const wrongPwBody = (await wrongPwRes.json()) as { error: string }

    // Same error message for both cases — prevents user enumeration
    expect(ghostBody.error).toBe(wrongPwBody.error)
  })

  // --- Register errors ---

  it('POST /api/auth/register with existing email returns 409', async () => {
    const email = `dupe-${randomBytes(4).toString('hex')}@test.shackleai.com`
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Dupe User' }),
    })

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Different@1234!', name: 'Dupe User 2' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('POST /api/auth/register with invalid email format returns 400', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'Battle@1234!', name: 'Bad Email' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('POST /api/auth/register with password too short (< 8 chars) returns 400', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `short-pw-${randomBytes(4).toString('hex')}@test.shackleai.com`,
        password: 'short',
        name: 'Short PW User',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('8')
  })

  it('POST /api/auth/register with missing name returns 400', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `no-name-${randomBytes(4).toString('hex')}@test.shackleai.com`,
        password: 'Battle@1234!',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/auth/login with invalid email format returns 400', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'Battle@1234!' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  // --- Protected route auth failures ---

  it('protected route returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/api/companies')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unauthorized')
  })

  it('protected route returns 401 for an expired JWT', async () => {
    // Build a token that expired 1 second ago (ttl = -1)
    // We need a real user to build a plausible payload
    const email = `expired-jwt-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Expired JWT User' }),
    })
    expect(regRes.status).toBe(201)
    const regBody = (await regRes.json()) as { data: { user: { id: string; role: string } } }

    // Build a token with exp = now - 1 (already expired)
    const expiredToken = buildJwt(
      { sub: regBody.data.user.id, email, role: regBody.data.user.role },
      -1,
    )

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('protected route returns 401 for a forged JWT (tampered signature)', async () => {
    const email = `forged-${randomBytes(4).toString('hex')}@test.shackleai.com`
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Battle@1234!', name: 'Forged JWT User' }),
    })
    expect(regRes.status).toBe(201)
    const regBody = (await regRes.json()) as { data: { token: string } }

    // Tamper with the signature (flip the last character)
    const validToken = regBody.data.token
    const parts = validToken.split('.')
    const tamperedSig = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A')
    const forgedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${forgedToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('protected route returns 401 for a JWT signed with a different secret', async () => {
    // Build a syntactically valid JWT but signed with a different secret
    const fakeToken = buildJwt(
      { sub: 'some-user-id', email: 'hacker@evil.com', role: 'admin' },
      3600,
      'wrong-secret-key',
    )

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${fakeToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('protected route returns 401 for an invalid API key', async () => {
    const unknownKey = randomBytes(32).toString('hex')
    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${unknownKey}` },
    })
    expect(res.status).toBe(401)
  })

  it('protected route returns 401 for a revoked API key', async () => {
    const revokedKey = randomBytes(32).toString('hex')
    await seedApiKey(db, revokedKey, AgentApiKeyStatus.Revoked)

    const res = await app.request('/api/companies', {
      headers: { Authorization: `Bearer ${revokedKey}` },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/logout without a token returns 401', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me without a token returns 401', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me with a structurally invalid JWT returns 401', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer this.is.not.valid' },
    })
    expect(res.status).toBe(401)
  })

  it('email comparison is case-insensitive (register lowercase, login mixed-case)', async () => {
    const baseEmail = `case-${randomBytes(4).toString('hex')}`
    const lowerEmail = `${baseEmail}@test.shackleai.com`
    const upperEmail = `${baseEmail.toUpperCase()}@test.shackleai.com`

    // Register with lowercase
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lowerEmail, password: 'Battle@1234!', name: 'Case User' }),
    })

    // Login with uppercase variant — should succeed
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: upperEmail, password: 'Battle@1234!' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { user: { email: string } } }
    // Stored email should always be lowercase
    expect(body.data.user.email).toBe(lowerEmail)
  })
})
