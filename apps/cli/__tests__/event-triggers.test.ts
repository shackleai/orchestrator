import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { TriggerType } from '@shackleai/shared'
import type { Scheduler } from '@shackleai/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string; issue_counter: number }
type AgentRow = { id: string; name: string }
type IssueRow = {
  id: string
  identifier: string
  issue_number: number
  title: string
  status: string
  priority: string
  assignee_agent_id: string | null
  company_id: string
}

async function createCompany(
  app: ReturnType<typeof createApp>,
  prefix: string,
): Promise<CompanyRow> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Company ${prefix}`, issue_prefix: prefix }),
  })
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function createAgent(
  db: PGliteProvider,
  companyId: string,
  name: string = 'Test Agent',
): Promise<AgentRow> {
  const result = await db.query<AgentRow>(
    `INSERT INTO agents (company_id, name, adapter_type, adapter_config)
     VALUES ($1, $2, 'process', '{}')
     RETURNING id, name`,
    [companyId, name],
  )
  return result.rows[0]
}

function createMockScheduler(): Scheduler & { triggerNow: ReturnType<typeof vi.fn> } {
  return {
    triggerNow: vi.fn().mockResolvedValue(null),
  } as unknown as Scheduler & { triggerNow: ReturnType<typeof vi.fn> }
}

// ---------------------------------------------------------------------------
// Tests — Task Assignment Triggers
// ---------------------------------------------------------------------------

describe('event triggers — task assignment', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string
  let agentId2: string
  let mockScheduler: ReturnType<typeof createMockScheduler>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    mockScheduler = createMockScheduler()
    app = createApp(db, { scheduler: mockScheduler })
    const company = await createCompany(app, 'TRIG')
    companyId = company.id
    const agent = await createAgent(db, companyId, 'worker-alpha')
    agentId = agent.id
    const agent2 = await createAgent(db, companyId, 'worker-beta')
    agentId2 = agent2.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST create issue with assignee triggers task_assigned', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Assigned on create', assignee_agent_id: agentId }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).toHaveBeenCalledWith(agentId, TriggerType.TaskAssigned)
  })

  it('POST create issue without assignee does not trigger', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No assignee' }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).not.toHaveBeenCalled()
  })

  it('PATCH update assignee_agent_id triggers task_assigned for new assignee', async () => {
    // Create issue without assignee
    const createRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Will be assigned' }),
    })
    const issue = ((await createRes.json()) as { data: IssueRow }).data

    mockScheduler.triggerNow.mockClear()

    const patchRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_agent_id: agentId }),
    })
    expect(patchRes.status).toBe(200)

    expect(mockScheduler.triggerNow).toHaveBeenCalledWith(agentId, TriggerType.TaskAssigned)
  })

  it('PATCH reassign to different agent triggers for new agent only', async () => {
    // Create issue assigned to agent1
    const createRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Reassign me', assignee_agent_id: agentId }),
    })
    const issue = ((await createRes.json()) as { data: IssueRow }).data

    mockScheduler.triggerNow.mockClear()

    // Reassign to agent2
    const patchRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_agent_id: agentId2 }),
    })
    expect(patchRes.status).toBe(200)

    expect(mockScheduler.triggerNow).toHaveBeenCalledWith(agentId2, TriggerType.TaskAssigned)
    expect(mockScheduler.triggerNow).not.toHaveBeenCalledWith(agentId, expect.anything())
  })

  it('PATCH same assignee does not re-trigger', async () => {
    // Create issue assigned to agent1
    const createRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Same assignee', assignee_agent_id: agentId }),
    })
    const issue = ((await createRes.json()) as { data: IssueRow }).data

    mockScheduler.triggerNow.mockClear()

    // Update with same assignee
    const patchRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_agent_id: agentId }),
    })
    expect(patchRes.status).toBe(200)

    expect(mockScheduler.triggerNow).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests — Comment Mention Triggers
// ---------------------------------------------------------------------------

describe('event triggers — comment mentions', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string
  let agentId: string
  let mockScheduler: ReturnType<typeof createMockScheduler>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    mockScheduler = createMockScheduler()
    app = createApp(db, { scheduler: mockScheduler })
    const company = await createCompany(app, 'MENT')
    companyId = company.id
    const agent = await createAgent(db, companyId, 'review-bot')
    agentId = agent.id

    // Create an issue to attach comments to
    const issueRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mention Test Issue' }),
    })
    const issue = ((await issueRes.json()) as { data: IssueRow }).data
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('comment mentioning @agent-name triggers mentioned for that agent', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hey @review-bot please review this' }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).toHaveBeenCalledWith(agentId, TriggerType.Mentioned)
  })

  it('comment mentioning non-existent agent does not trigger and does not crash', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hey @ghost-agent check this out' }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).not.toHaveBeenCalled()
  })

  it('comment with no mentions does not trigger', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Just a regular comment' }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).not.toHaveBeenCalled()
  })

  it('duplicate @mentions in a comment only trigger once', async () => {
    mockScheduler.triggerNow.mockClear()

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@review-bot please @review-bot' }),
    })
    expect(res.status).toBe(201)

    expect(mockScheduler.triggerNow).toHaveBeenCalledTimes(1)
    expect(mockScheduler.triggerNow).toHaveBeenCalledWith(agentId, TriggerType.Mentioned)
  })
})

// ---------------------------------------------------------------------------
// Tests — No Scheduler (graceful degradation)
// ---------------------------------------------------------------------------

describe('event triggers — no scheduler available', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    // No scheduler passed — should gracefully skip triggers
    app = createApp(db)
    const company = await createCompany(app, 'NOSC')
    companyId = company.id
    const agent = await createAgent(db, companyId, 'silent-agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('create issue with assignee does not crash without scheduler', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No scheduler', assignee_agent_id: agentId }),
    })
    expect(res.status).toBe(201)
  })

  it('comment with @mention does not crash without scheduler', async () => {
    const issueRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Comment test no sched' }),
    })
    const issue = ((await issueRes.json()) as { data: IssueRow }).data

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@silent-agent do something' }),
    })
    expect(res.status).toBe(201)
  })
})
