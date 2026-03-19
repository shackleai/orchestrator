import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

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
type CommentRow = {
  id: string
  issue_id: string
  content: string
  parent_id: string | null
  is_resolved: boolean
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
  // Insert directly — agents route lives on a parallel branch
  const result = await db.query<AgentRow>(
    `INSERT INTO agents (company_id, name, adapter_type, adapter_config)
     VALUES ($1, $2, 'process', '{}')
     RETURNING id, name`,
    [companyId, name],
  )
  return result.rows[0]
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Default Issue', ...overrides }),
  })
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issues routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CRUD')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/issues returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/issues creates an issue', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First Issue', priority: 'high' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.title).toBe('First Issue')
    expect(body.data.priority).toBe('high')
    expect(body.data.status).toBe('backlog')
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.id).toBeTruthy()
  })

  it('POST /api/companies/:id/issues returns 400 on missing title', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'low' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/issues returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/companies/:id/issues/:issueId returns issue detail', async () => {
    const issue = await createIssue(app, companyId, { title: 'Detail Issue' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.id).toBe(issue.id)
    expect(body.data.title).toBe('Detail Issue')
  })

  it('GET /api/companies/:id/issues/:issueId returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('PATCH /api/companies/:id/issues/:issueId updates issue fields', async () => {
    const issue = await createIssue(app, companyId, { title: 'Patch Issue' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo', priority: 'critical' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('todo')
    expect(body.data.priority).toBe('critical')
  })

  it('PATCH /api/companies/:id/issues/:issueId returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH /api/companies/:id/issues/:issueId returns 400 on validation error', async () => {
    const issue = await createIssue(app, companyId, { title: 'Validate Issue' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid_status_value' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/companies/:id/issues lists multiple issues', async () => {
    await createIssue(app, companyId, { title: 'List Issue A' })
    await createIssue(app, companyId, { title: 'List Issue B' })

    const res = await app.request(`/api/companies/${companyId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.length).toBeGreaterThan(1)
  })
})

describe('issues routes — auto-generated identifier', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'ACME')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('auto-generates identifier from company prefix + counter (ACME-1)', async () => {
    const issue = await createIssue(app, companyId, { title: 'First' })
    expect(issue.identifier).toBe('ACME-1')
    expect(issue.issue_number).toBe(1)
  })

  it('auto-increments identifier for sequential issues (ACME-2, ACME-3)', async () => {
    const second = await createIssue(app, companyId, { title: 'Second' })
    const third = await createIssue(app, companyId, { title: 'Third' })
    expect(second.identifier).toBe('ACME-2')
    expect(third.identifier).toBe('ACME-3')
  })

  it('different companies have independent counters', async () => {
    const other = await createCompany(app, 'BETA')
    const betaIssue = await createIssue(app, other.id, { title: 'Beta First' })
    expect(betaIssue.identifier).toBe('BETA-1')
  })
})

describe('issues routes — atomic checkout', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId1: string
  let agentId2: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CHKOUT')
    companyId = company.id
    // Create real agents to satisfy FK constraint
    const agent1 = await createAgent(db, companyId, 'Worker Agent 1')
    const agent2 = await createAgent(db, companyId, 'Worker Agent 2')
    agentId1 = agent1.id
    agentId2 = agent2.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('checkout succeeds for an unassigned backlog issue', async () => {
    const issue = await createIssue(app, companyId, { title: 'Checkout Issue' })
    expect(issue.status).toBe('backlog')

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId1 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
    expect(body.data.assignee_agent_id).toBe(agentId1)
  })

  it('checkout returns 409 if issue is already claimed', async () => {
    const issue = await createIssue(app, companyId, { title: 'Already Claimed' })

    // First claim succeeds
    const first = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId1 }),
      },
    )
    expect(first.status).toBe(200)

    // Second claim returns 409
    const second = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId2 }),
      },
    )
    expect(second.status).toBe(409)
    const body = (await second.json()) as { error: string }
    expect(body.error).toContain('already claimed')
  })

  it('checkout returns 409 for issue in done status', async () => {
    const issue = await createIssue(app, companyId, {
      title: 'Done Issue',
      status: 'done',
    })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId1 }),
    })
    expect(res.status).toBe(409)
  })

  it('checkout succeeds for todo status issue', async () => {
    const issue = await createIssue(app, companyId, {
      title: 'Todo Issue',
      status: 'todo',
    })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId1 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
  })

  it('checkout returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId1 }),
      },
    )
    expect(res.status).toBe(404)
  })
})

describe('issues routes — release', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId1: string
  let agentId2: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'REL')
    companyId = company.id
    const agent1 = await createAgent(db, companyId, 'Release Agent 1')
    const agent2 = await createAgent(db, companyId, 'Release Agent 2')
    agentId1 = agent1.id
    agentId2 = agent2.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('release unassigns the issue and sets status to todo', async () => {
    const issue = await createIssue(app, companyId, { title: 'Release Me' })

    // Checkout first
    await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId1 }),
    })

    // Release
    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/release`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('todo')
    expect(body.data.assignee_agent_id).toBeNull()
  })

  it('release returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/release`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })

  it('released issue can be checked out again', async () => {
    const issue = await createIssue(app, companyId, { title: 'Recheckout Me' })

    // Checkout
    await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId1 }),
    })

    // Release
    await app.request(`/api/companies/${companyId}/issues/${issue.id}/release`, {
      method: 'POST',
    })

    // Recheckout — should succeed
    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId2 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.assignee_agent_id).toBe(agentId2)
  })
})

describe('issues routes — comments', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CMT')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Issue For Comments' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /comments returns empty array for new issue', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /comments creates a comment', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello world' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CommentRow }
    expect(body.data.content).toBe('Hello world')
    expect(body.data.issue_id).toBe(issueId)
    expect(body.data.parent_id).toBeNull()
    expect(body.data.is_resolved).toBe(false)
  })

  it('POST /comments returns 400 on missing content', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_agent_id: null }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /comments returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /comments lists comments ordered by created_at', async () => {
    // Create a second comment
    await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Second comment' }),
    })

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    // Ordered ASC by created_at — first created should be first
    expect(body.data[0].content).toBe('Hello world')
  })

  it('POST /comments supports threading via parent_id', async () => {
    // Create parent comment
    const parentRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Parent comment' }),
      },
    )
    const parentBody = (await parentRes.json()) as { data: CommentRow }
    const parentCommentId = parentBody.data.id

    // Create threaded reply
    const replyRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Reply comment', parent_id: parentCommentId }),
      },
    )
    expect(replyRes.status).toBe(201)
    const replyBody = (await replyRes.json()) as { data: CommentRow }
    expect(replyBody.data.parent_id).toBe(parentCommentId)
  })

  it('POST /comments returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Ghost comment' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('GET /comments returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/comments`,
    )
    expect(res.status).toBe(404)
  })
})

describe('issues routes — filtering', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let filtAgentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'FILT')
    companyId = company.id
    const filtAgent = await createAgent(db, companyId, 'Filter Test Agent')
    filtAgentId = filtAgent.id

    // Seed issues with various statuses/priorities
    await createIssue(app, companyId, { title: 'Backlog Low', status: 'backlog', priority: 'low' })
    await createIssue(app, companyId, { title: 'Todo High', status: 'todo', priority: 'high' })
    await createIssue(app, companyId, { title: 'Todo Medium', status: 'todo', priority: 'medium' })
    await createIssue(app, companyId, {
      title: 'Done Critical',
      status: 'done',
      priority: 'critical',
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('filters by status', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?status=todo`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.every((i) => i.status === 'todo')).toBe(true)
    expect(body.data).toHaveLength(2)
  })

  it('filters by priority', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?priority=high`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.every((i) => i.priority === 'high')).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('filters by status and priority combined', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?status=todo&priority=medium`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe('Todo Medium')
  })

  it('returns empty array when no issues match filter', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues?status=in_review`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('filters by assignee', async () => {
    // Create and checkout an issue so it has a real assignee
    const issue = await createIssue(app, companyId, { title: 'Assigned Issue' })
    await app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: filtAgentId }),
    })

    const res = await app.request(
      `/api/companies/${companyId}/issues?assignee=${filtAgentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    expect(body.data.every((i) => i.assignee_agent_id === filtAgentId)).toBe(true)
  })
})

describe('issues routes — lifecycle guards (parent/child)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'GUARD')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('rejects completing a parent issue when children are incomplete', async () => {
    const parent = await createIssue(app, companyId, { title: 'Parent Task', status: 'in_progress' })
    await createIssue(app, companyId, { title: 'Child A', parent_id: parent.id, status: 'in_progress' })
    await createIssue(app, companyId, { title: 'Child B', parent_id: parent.id, status: 'backlog' })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; incomplete_children: unknown[]; message: string }
    expect(body.error).toBe('Cannot complete parent issue while children are incomplete')
    expect(body.incomplete_children).toHaveLength(2)
    expect(body.message).toContain('Child A')
    expect(body.message).toContain('Child B')
  })

  it('rejects cancelling a parent issue when children are incomplete', async () => {
    const parent = await createIssue(app, companyId, { title: 'Cancel Parent', status: 'in_progress' })
    await createIssue(app, companyId, { title: 'Active Child', parent_id: parent.id, status: 'todo' })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Cannot complete parent issue while children are incomplete')
  })

  it('allows completing a parent when all children are done', async () => {
    const parent = await createIssue(app, companyId, { title: 'Good Parent', status: 'in_progress' })
    await createIssue(app, companyId, { title: 'Done Child 1', parent_id: parent.id, status: 'done' })
    await createIssue(app, companyId, { title: 'Done Child 2', parent_id: parent.id, status: 'done' })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('allows completing a parent when all children are done or cancelled', async () => {
    const parent = await createIssue(app, companyId, { title: 'Mixed Parent', status: 'in_progress' })
    await createIssue(app, companyId, { title: 'Done Child', parent_id: parent.id, status: 'done' })
    await createIssue(app, companyId, { title: 'Cancelled Child', parent_id: parent.id, status: 'cancelled' })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('allows completing an issue with no children (leaf task)', async () => {
    const leaf = await createIssue(app, companyId, { title: 'Leaf Task', status: 'in_progress' })

    const res = await app.request(`/api/companies/${companyId}/issues/${leaf.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('allows non-terminal status changes on parent with incomplete children', async () => {
    const parent = await createIssue(app, companyId, { title: 'Status Change Parent', status: 'backlog' })
    await createIssue(app, companyId, { title: 'WIP Child', parent_id: parent.id, status: 'in_progress' })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
  })
})
