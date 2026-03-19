/**
 * E2E: Issue Read States + Inbox / Notification Center
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

interface IssueRow { id: string; identifier: string; title: string; status: string }
interface AgentRow { id: string; name: string }
interface ReadStateRow { issue_id: string; user_or_agent_id: string; last_read_at: string }
interface InboxItemRow { type: string; id: string; title: string; timestamp: string; meta?: Record<string, unknown> }
interface InboxCount { unread_issues: number; pending_approvals: number; new_comments: number; total: number }

let db: PGliteProvider
let app: ReturnType<typeof createApp>
let companyId: string
let agentId: string

async function createCompany(name = 'Inbox Corp'): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: 'INB' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(name: string): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role: 'general' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function createIssue(title: string, assignee?: string): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, ...(assignee ? { assignee_agent_id: assignee } : {}) }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

async function createApproval(type: string, payload: Record<string, unknown>): Promise<{ id: string }> {
  const res = await app.request(`/api/companies/${companyId}/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data
}

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  app = createApp(db, { skipAuth: true })
  companyId = await createCompany()
  const agent = await createAgent('inbox-test-agent')
  agentId = agent.id
}, 30000)

afterAll(async () => {
  await db.close()
})

describe('Mark as Read', () => {
  it('marks an issue as read', async () => {
    const issue = await createIssue('Read test issue')
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_or_agent_id: agentId }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ReadStateRow }
    expect(body.data.issue_id).toBe(issue.id)
    expect(body.data.user_or_agent_id).toBe(agentId)
    expect(body.data.last_read_at).toBeTruthy()
  })

  it('updates last_read_at on re-read', async () => {
    const issue = await createIssue('Re-read test')
    const res1 = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_or_agent_id: agentId }),
      },
    )
    expect(res1.status).toBe(200)
    const body1 = (await res1.json()) as { data: ReadStateRow }

    await new Promise((r) => setTimeout(r, 50))

    const res2 = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_or_agent_id: agentId }),
      },
    )
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { data: ReadStateRow }

    expect(new Date(body2.data.last_read_at).getTime()).toBeGreaterThanOrEqual(
      new Date(body1.data.last_read_at).getTime(),
    )
  })

  it('returns 400 for missing user_or_agent_id', async () => {
    const issue = await createIssue('Bad read test')
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent issue', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request(
      `/api/companies/${companyId}/issues/${fakeId}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_or_agent_id: agentId }),
      },
    )
    expect(res.status).toBe(404)
  })
})

describe('Inbox', () => {
  it('returns unread issues in inbox', async () => {
    const issue = await createIssue('Inbox unread issue')
    const res = await app.request(
      `/api/companies/${companyId}/inbox?user_or_agent_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: InboxItemRow[] }
    const unread = body.data.filter((item) => item.type === 'unread_issue')
    const found = unread.find((item) => item.id === issue.id)
    expect(found).toBeTruthy()
    expect(found!.title).toContain('Inbox unread issue')
  })

  it('excludes read issues from inbox', async () => {
    const issue = await createIssue('Read issue should not appear')
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_or_agent_id: agentId }),
      },
    )

    const res = await app.request(
      `/api/companies/${companyId}/inbox?user_or_agent_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: InboxItemRow[] }
    const found = body.data.find(
      (item) => item.type === 'unread_issue' && item.id === issue.id,
    )
    expect(found).toBeUndefined()
  })

  it('includes pending approvals in inbox', async () => {
    const approval = await createApproval('agent_create', { name: 'New Agent' })
    const res = await app.request(
      `/api/companies/${companyId}/inbox?user_or_agent_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: InboxItemRow[] }
    const found = body.data.find(
      (item) => item.type === 'pending_approval' && item.id === approval.id,
    )
    expect(found).toBeTruthy()
  })

  it('returns 400 without user_or_agent_id', async () => {
    const res = await app.request(`/api/companies/${companyId}/inbox`)
    expect(res.status).toBe(400)
  })
})

describe('Inbox Count', () => {
  it('returns correct unread counts', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/inbox/count?user_or_agent_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: InboxCount }
    expect(body.data.unread_issues).toBeGreaterThanOrEqual(0)
    expect(body.data.pending_approvals).toBeGreaterThanOrEqual(0)
    expect(body.data.new_comments).toBeGreaterThanOrEqual(0)
    expect(body.data.total).toBe(
      body.data.unread_issues + body.data.pending_approvals + body.data.new_comments,
    )
  })

  it('returns 400 without user_or_agent_id', async () => {
    const res = await app.request(`/api/companies/${companyId}/inbox/count`)
    expect(res.status).toBe(400)
  })
})

describe('Auto-mark as read on GET', () => {
  it('auto-marks issue as read when reader_id is provided', async () => {
    const issue = await createIssue('Auto-read issue')
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}?reader_id=${agentId}`,
    )
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 100))

    const inboxRes = await app.request(
      `/api/companies/${companyId}/inbox?user_or_agent_id=${agentId}`,
    )
    const body = (await inboxRes.json()) as { data: InboxItemRow[] }
    const found = body.data.find(
      (item) => item.type === 'unread_issue' && item.id === issue.id,
    )
    expect(found).toBeUndefined()
  })
})
