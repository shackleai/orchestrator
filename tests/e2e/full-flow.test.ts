/**
 * E2E: Full orchestrator flow
 *
 * Tests the complete happy path:
 *   company → agents → tasks → checkout → complete → dashboard metrics
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRow = { id: string; name: string; status: string }
type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  assignee_agent_id: string | null
}
type DashboardMetrics = {
  agentCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  totalSpendCents: number
  recentActivity: unknown[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  name = 'Test Corp',
): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: name.toUpperCase().slice(0, 4) }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Agent', adapter_type: 'process', ...overrides }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test Task', ...overrides }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('E2E: full orchestrator flow', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agent1: AgentRow
  let agent2: AgentRow
  let task1: IssueRow
  let task2: IssueRow

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
  })

  afterAll(async () => {
    await db.close()
  })

  it('step 1 — creates a company via POST /api/companies', async () => {
    companyId = await createCompany(app, 'Flow Corp')
    expect(companyId).toBeTruthy()
  })

  it('step 2 — creates agent1 via POST /api/companies/:id/agents', async () => {
    agent1 = await createAgent(app, companyId, { name: 'Agent Alpha' })
    expect(agent1.id).toBeTruthy()
    expect(agent1.name).toBe('Agent Alpha')
    expect(agent1.status).toBe('idle')
  })

  it('step 2 — creates agent2 via POST /api/companies/:id/agents', async () => {
    agent2 = await createAgent(app, companyId, { name: 'Agent Beta' })
    expect(agent2.id).toBeTruthy()
    expect(agent2.name).toBe('Agent Beta')
  })

  it('step 2 — both agents appear in GET /api/companies/:id/agents', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data.length).toBe(2)
    const names = body.data.map((a) => a.name)
    expect(names).toContain('Agent Alpha')
    expect(names).toContain('Agent Beta')
  })

  it('step 3 — creates task1 via POST /api/companies/:id/issues', async () => {
    task1 = await createIssue(app, companyId, { title: 'Implement feature A' })
    expect(task1.id).toBeTruthy()
    expect(task1.title).toBe('Implement feature A')
    expect(task1.status).toBe('backlog')
    expect(task1.assignee_agent_id).toBeNull()
  })

  it('step 3 — creates task2 via POST /api/companies/:id/issues', async () => {
    task2 = await createIssue(app, companyId, { title: 'Write tests for feature A' })
    expect(task2.id).toBeTruthy()
    expect(task2.status).toBe('backlog')
  })

  it('step 4 — agent1 checks out task1 via POST /api/companies/:id/issues/:taskId/checkout', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${task1.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent1.id }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
    expect(body.data.assignee_agent_id).toBe(agent1.id)
  })

  it('step 4 — agent2 checks out task2 via POST /api/companies/:id/issues/:taskId/checkout', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${task2.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent2.id }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
    expect(body.data.assignee_agent_id).toBe(agent2.id)
  })

  it('step 5 — inserts heartbeat runs directly into db', async () => {
    await db.query(
      `INSERT INTO heartbeat_runs (company_id, agent_id, trigger_type, status)
       VALUES ($1, $2, 'manual', 'completed'), ($3, $4, 'manual', 'completed')`,
      [companyId, agent1.id, companyId, agent2.id],
    )

    const res = await app.request(`/api/companies/${companyId}/heartbeats`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)
  })

  it('step 6 — dashboard metrics show 2 agents and 2 open tasks', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }

    expect(body.data.agentCount).toBe(2)
    expect(body.data.taskCount).toBe(2)
    // Both tasks are in_progress which is NOT done/cancelled → openTasks = 2
    expect(body.data.openTasks).toBe(2)
    expect(body.data.completedTasks).toBe(0)
    expect(body.data.totalSpendCents).toBe(0)
  })

  it('step 7 — completes task1 via PATCH /api/companies/:id/issues/:taskId', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${task1.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('step 7 — completes task2 via PATCH /api/companies/:id/issues/:taskId', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${task2.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('step 8 — dashboard metrics show 2 completed tasks after completion', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }

    expect(body.data.completedTasks).toBe(2)
    // done status is excluded from openTasks count
    expect(body.data.openTasks).toBe(0)
  })

  it('step 9 — activity log is accessible via GET /api/companies/:id/activity', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('step 10 — heartbeat detail is accessible via GET /api/companies/:id/heartbeats/:runId', async () => {
    const listRes = await app.request(`/api/companies/${companyId}/heartbeats`)
    const listBody = (await listRes.json()) as { data: Array<{ id: string }> }
    const runId = listBody.data[0].id

    const res = await app.request(`/api/companies/${companyId}/heartbeats/${runId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string } }
    expect(body.data.id).toBe(runId)
  })
})
