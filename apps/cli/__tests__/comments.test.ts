import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import type { Scheduler } from '@shackleai/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string; issue_counter: number }
type AgentRow = { id: string; name: string }
type IssueRow = { id: string; identifier: string; title: string; company_id: string }
type CommentRow = {
  id: string
  issue_id: string
  content: string
  author_agent_id: string | null
  parent_id: string | null
  is_resolved: boolean
  created_at: string
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

async function postComment(
  app: ReturnType<typeof createApp>,
  companyId: string,
  issueId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/issues/${issueId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------------------
// Tests — CRUD
// ---------------------------------------------------------------------------

describe('comments routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CMTS')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Comment Target' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST creates a comment and returns 201', async () => {
    const res = await postComment(app, companyId, issueId, { content: 'First comment' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CommentRow }
    expect(body.data.content).toBe('First comment')
    expect(body.data.issue_id).toBe(issueId)
    expect(body.data.author_agent_id).toBeNull()
    expect(body.data.parent_id).toBeNull()
    expect(body.data.is_resolved).toBe(false)
  })

  it('GET list returns comments sorted by created_at ASC', async () => {
    // Add a second comment
    await postComment(app, companyId, issueId, { content: 'Second comment' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/comments`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    // First created should be first in the list (ASC order)
    expect(body.data[0].content).toBe('First comment')
  })

  it('GET single returns a specific comment', async () => {
    // Create a comment and fetch it by ID
    const createRes = await postComment(app, companyId, issueId, { content: 'Fetchable' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow }
    expect(body.data.id).toBe(commentId)
    expect(body.data.content).toBe('Fetchable')
  })

  it('DELETE removes a comment and returns 200', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Delete me' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    // Delete
    const deleteRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { data: CommentRow }
    expect(deleteBody.data.id).toBe(commentId)

    // Verify it's gone
    const getRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
    )
    expect(getRes.status).toBe(404)
  })

  it('POST returns 400 on empty body (missing content)', async () => {
    const res = await postComment(app, companyId, issueId, {})
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST returns 400 on invalid JSON', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    )
    expect(res.status).toBe(400)
  })

  it('POST returns 404 for non-existent issue', async () => {
    const res = await postComment(app, companyId, '00000000-0000-0000-0000-000000000000', {
      content: 'Ghost',
    })
    expect(res.status).toBe(404)
  })

  it('GET list returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/comments`,
    )
    expect(res.status).toBe(404)
  })

  it('GET single returns 404 for non-existent comment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
  })

  it('DELETE returns 404 for non-existent comment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Tests — Threading
// ---------------------------------------------------------------------------

describe('comments routes — threading', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'THRD')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Thread Target' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('supports threaded replies via parent_id', async () => {
    // Create parent
    const parentRes = await postComment(app, companyId, issueId, { content: 'Parent' })
    const parent = (await parentRes.json()) as { data: CommentRow }

    // Create reply
    const replyRes = await postComment(app, companyId, issueId, {
      content: 'Reply',
      parent_id: parent.data.id,
    })
    expect(replyRes.status).toBe(201)
    const reply = (await replyRes.json()) as { data: CommentRow }
    expect(reply.data.parent_id).toBe(parent.data.id)
  })
})

// ---------------------------------------------------------------------------
// Tests — @mention triggers
// ---------------------------------------------------------------------------

describe('comments routes — @mention triggers', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string
  let mockScheduler: Scheduler

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)

    mockScheduler = {
      triggerNow: vi.fn().mockResolvedValue(undefined),
    } as unknown as Scheduler

    app = createApp(db, { skipAuth: true, scheduler: mockScheduler })
    const company = await createCompany(app, 'MENT')
    companyId = company.id

    // Create an agent that can be mentioned
    await createAgent(db, companyId, 'backend-bot')

    const issue = await createIssue(app, companyId, { title: 'Mention Target' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('fires trigger when comment contains @mention of existing agent', async () => {
    const triggerNow = mockScheduler.triggerNow as ReturnType<typeof vi.fn>
    triggerNow.mockClear()

    const res = await postComment(app, companyId, issueId, {
      content: 'Hey @backend-bot please review this',
    })
    expect(res.status).toBe(201)

    expect(triggerNow).toHaveBeenCalled()
  })

  it('does not fire trigger for non-existent agent mention', async () => {
    const triggerNow = vi.fn().mockResolvedValue(undefined)
    const scheduler = { triggerNow } as unknown as Scheduler
    const localApp = createApp(db, { skipAuth: true, scheduler })

    const res = await localApp.request(
      `/api/companies/${companyId}/issues/${issueId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hey @nonexistent-agent check this' }),
      },
    )
    expect(res.status).toBe(201)

    expect(triggerNow).not.toHaveBeenCalled()
  })
})
