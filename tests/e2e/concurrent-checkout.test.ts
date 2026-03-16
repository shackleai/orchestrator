/**
 * E2E: Concurrent checkout — conflict resolution
 *
 * Verifies the atomic checkout guarantee:
 *   - First agent to claim a task wins (200)
 *   - Second agent gets 409 Conflict
 *   - Task is assigned to the winning agent only
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRow = { id: string; name: string }
type IssueRow = {
  id: string
  status: string
  assignee_agent_id: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  name = 'Conflict Corp',
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
  name: string,
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, adapter_type: 'process' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  title = 'Contested Task',
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

async function checkoutIssue(
  app: ReturnType<typeof createApp>,
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('E2E: concurrent checkout — conflict resolution', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agent1: AgentRow
  let agent2: AgentRow

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)

    companyId = await createCompany(app, 'Conflict Corp')
    agent1 = await createAgent(app, companyId, 'Contender One')
    agent2 = await createAgent(app, companyId, 'Contender Two')
  })

  afterAll(async () => {
    await db.close()
  })

  it('agent1 successfully checks out an unassigned backlog task (200)', async () => {
    const issue = await createIssue(app, companyId, 'Contested Task 1')
    expect(issue.status).toBe('backlog')
    expect(issue.assignee_agent_id).toBeNull()

    const res = await checkoutIssue(app, companyId, issue.id, agent1.id)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
    expect(body.data.assignee_agent_id).toBe(agent1.id)
  })

  it('agent2 gets 409 Conflict when checking out a task already claimed by agent1', async () => {
    // Create a fresh task
    const issue = await createIssue(app, companyId, 'Single Slot Task')

    // agent1 claims it
    const first = await checkoutIssue(app, companyId, issue.id, agent1.id)
    expect(first.status).toBe(200)

    // agent2 tries to claim the same task — must fail
    const second = await checkoutIssue(app, companyId, issue.id, agent2.id)
    expect(second.status).toBe(409)

    const body = (await second.json()) as { error: string }
    expect(body.error).toContain('already claimed')
  })

  it('task remains assigned to agent1, not agent2, after the conflict', async () => {
    const issue = await createIssue(app, companyId, 'Ownership Task')

    // agent1 claims it
    await checkoutIssue(app, companyId, issue.id, agent1.id)

    // agent2 fails to claim
    await checkoutIssue(app, companyId, issue.id, agent2.id)

    // Verify ownership via GET issue detail
    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.assignee_agent_id).toBe(agent1.id)
    expect(body.data.status).toBe('in_progress')
  })

  it('simulated concurrent checkout — both fire simultaneously, exactly one succeeds', async () => {
    const issue = await createIssue(app, companyId, 'Race Condition Task')

    // Fire both requests without awaiting each other first
    const [res1, res2] = await Promise.all([
      checkoutIssue(app, companyId, issue.id, agent1.id),
      checkoutIssue(app, companyId, issue.id, agent2.id),
    ])

    const statuses = [res1.status, res2.status].sort()
    // Exactly one 200 and one 409
    expect(statuses).toEqual([200, 409])
  })

  it('agent2 can claim a different task while agent1 holds another', async () => {
    const issueA = await createIssue(app, companyId, 'Task for Agent 1')
    const issueB = await createIssue(app, companyId, 'Task for Agent 2')

    const resA = await checkoutIssue(app, companyId, issueA.id, agent1.id)
    const resB = await checkoutIssue(app, companyId, issueB.id, agent2.id)

    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const bodyA = (await resA.json()) as { data: IssueRow }
    const bodyB = (await resB.json()) as { data: IssueRow }

    expect(bodyA.data.assignee_agent_id).toBe(agent1.id)
    expect(bodyB.data.assignee_agent_id).toBe(agent2.id)
  })

  it('same agent cannot check out the same task twice (409 on re-checkout)', async () => {
    const issue = await createIssue(app, companyId, 'Double Checkout Task')

    const first = await checkoutIssue(app, companyId, issue.id, agent1.id)
    expect(first.status).toBe(200)

    // Same agent tries again — task is in_progress, not backlog/todo → 409
    const second = await checkoutIssue(app, companyId, issue.id, agent1.id)
    expect(second.status).toBe(409)
  })

  it('released task can be claimed by a different agent', async () => {
    const issue = await createIssue(app, companyId, 'Release and Reclaim Task')

    // agent1 claims it
    await checkoutIssue(app, companyId, issue.id, agent1.id)

    // agent1 releases it
    const releaseRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/release`,
      { method: 'POST' },
    )
    expect(releaseRes.status).toBe(200)

    // agent2 now claims it successfully
    const res = await checkoutIssue(app, companyId, issue.id, agent2.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.assignee_agent_id).toBe(agent2.id)
  })

  it('returns 404 when checking out a non-existent task', async () => {
    const res = await checkoutIssue(
      app,
      companyId,
      '00000000-0000-0000-0000-000000000000',
      agent1.id,
    )
    expect(res.status).toBe(404)
  })
})
