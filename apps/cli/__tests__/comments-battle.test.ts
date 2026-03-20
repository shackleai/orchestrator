/**
 * Comments Battle Test — #276
 *
 * Covers scenarios NOT already in comments.test.ts or e2e-battle.test.ts:
 *   - PATCH (edit content, resolve, unresolve)
 *   - Edit after resolve
 *   - Deeply nested replies (3 levels)
 *   - Delete parent comment — verifies children are orphaned (ON DELETE SET NULL)
 *   - PATCH non-existent comment → 404
 *   - PATCH with empty content → 400
 *   - PATCH with no fields → 400
 *   - Resolve then unresolve cycle
 *   - Multi-tenant: comment on wrong company's issue → 404
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string }
type IssueRow = { id: string; identifier: string; title: string }
type CommentRow = {
  id: string
  issue_id: string
  content: string
  author_agent_id: string | null
  parent_id: string | null
  is_resolved: boolean
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  prefix: string,
): Promise<CompanyRow> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `BattleComments ${prefix}`, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  title = 'Battle Issue',
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

async function patchComment(
  app: ReturnType<typeof createApp>,
  companyId: string,
  issueId: string,
  commentId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    `/api/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
}

// ---------------------------------------------------------------------------
// Battle: PATCH — edit, resolve, unresolve
// ---------------------------------------------------------------------------

describe('comments battle — PATCH edit, resolve, unresolve (#276)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CBED')
    companyId = company.id
    const issue = await createIssue(app, companyId, 'PATCH battle target')
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('PATCH can edit comment content', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Original content' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, {
      content: 'Edited content',
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CommentRow }
    expect(body.data.content).toBe('Edited content')
    expect(body.data.id).toBe(commentId)
  })

  it('PATCH can resolve a comment', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Resolve me' })
    const created = (await createRes.json()) as { data: CommentRow }
    expect(created.data.is_resolved).toBe(false)
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, {
      is_resolved: true,
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CommentRow }
    expect(body.data.is_resolved).toBe(true)
  })

  it('PATCH can unresolve a previously resolved comment', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Resolve then unresolve' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    // Resolve
    await patchComment(app, companyId, issueId, commentId, { is_resolved: true })

    // Unresolve
    const patchRes = await patchComment(app, companyId, issueId, commentId, {
      is_resolved: false,
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CommentRow }
    expect(body.data.is_resolved).toBe(false)
  })

  it('PATCH can update content and is_resolved in one request', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Multi-field update' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, {
      content: 'Updated and resolved',
      is_resolved: true,
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CommentRow }
    expect(body.data.content).toBe('Updated and resolved')
    expect(body.data.is_resolved).toBe(true)
  })

  it('PATCH can edit content of a resolved comment', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Before resolve' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    // Resolve first
    await patchComment(app, companyId, issueId, commentId, { is_resolved: true })

    // Edit content while resolved
    const patchRes = await patchComment(app, companyId, issueId, commentId, {
      content: 'Edited after resolve',
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CommentRow }
    expect(body.data.content).toBe('Edited after resolve')
    expect(body.data.is_resolved).toBe(true)
  })

  it('PATCH with empty content string returns 400', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Non-empty' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, { content: '' })
    expect(patchRes.status).toBe(400)
    const body = (await patchRes.json()) as { error: string }
    expect(body.error).toBe('Content cannot be empty')
  })

  it('PATCH with whitespace-only content returns 400', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'Needs trimming' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, { content: '   ' })
    expect(patchRes.status).toBe(400)
    const body = (await patchRes.json()) as { error: string }
    expect(body.error).toBe('Content cannot be empty')
  })

  it('PATCH with no updatable fields returns 400', async () => {
    const createRes = await postComment(app, companyId, issueId, { content: 'No update fields' })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    const patchRes = await patchComment(app, companyId, issueId, commentId, {})
    expect(patchRes.status).toBe(400)
    const body = (await patchRes.json()) as { error: string }
    expect(body.error).toBe('No fields to update')
  })

  it('PATCH non-existent comment returns 404', async () => {
    const patchRes = await patchComment(
      app,
      companyId,
      issueId,
      '00000000-0000-0000-0000-000000000000',
      { content: 'Ghost edit' },
    )
    expect(patchRes.status).toBe(404)
  })

  it('PATCH on a comment belonging to a different issue returns 404', async () => {
    const otherIssue = await createIssue(app, companyId, 'Other Issue')
    const createRes = await postComment(app, companyId, issueId, {
      content: 'Comment on issue A',
    })
    const created = (await createRes.json()) as { data: CommentRow }
    const commentId = created.data.id

    // Try to PATCH using a different issue's URL
    const patchRes = await patchComment(app, companyId, otherIssue.id, commentId, {
      content: 'Cross-issue edit attempt',
    })
    expect(patchRes.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle: deeply nested replies
// ---------------------------------------------------------------------------

describe('comments battle — deeply nested replies (#276)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CNST')
    companyId = company.id
    const issue = await createIssue(app, companyId, 'Thread battle issue')
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('supports 3-level deep nested replies', async () => {
    // Level 1: root
    const l1Res = await postComment(app, companyId, issueId, { content: 'Level 1 root' })
    expect(l1Res.status).toBe(201)
    const l1 = (await l1Res.json()) as { data: CommentRow }
    expect(l1.data.parent_id).toBeNull()

    // Level 2: reply to root
    const l2Res = await postComment(app, companyId, issueId, {
      content: 'Level 2 reply',
      parent_id: l1.data.id,
    })
    expect(l2Res.status).toBe(201)
    const l2 = (await l2Res.json()) as { data: CommentRow }
    expect(l2.data.parent_id).toBe(l1.data.id)

    // Level 3: reply to reply
    const l3Res = await postComment(app, companyId, issueId, {
      content: 'Level 3 deep reply',
      parent_id: l2.data.id,
    })
    expect(l3Res.status).toBe(201)
    const l3 = (await l3Res.json()) as { data: CommentRow }
    expect(l3.data.parent_id).toBe(l2.data.id)

    // All 3 should appear in the flat list
    const listRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments`,
    )
    const listBody = (await listRes.json()) as { data: CommentRow[] }
    const ids = listBody.data.map((c) => c.id)
    expect(ids).toContain(l1.data.id)
    expect(ids).toContain(l2.data.id)
    expect(ids).toContain(l3.data.id)
  })

  it('reply to non-existent parent_id returns 404', async () => {
    const res = await postComment(app, companyId, issueId, {
      content: 'Orphan reply',
      parent_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Parent comment not found')
  })

  it('delete parent comment with children succeeds — children are orphaned (parent_id set to null)', async () => {
    const parentRes = await postComment(app, companyId, issueId, {
      content: 'Parent to delete',
    })
    const parent = (await parentRes.json()) as { data: CommentRow }

    const childRes = await postComment(app, companyId, issueId, {
      content: 'Child that becomes orphaned',
      parent_id: parent.data.id,
    })
    const child = (await childRes.json()) as { data: CommentRow }
    expect(child.data.parent_id).toBe(parent.data.id)

    // Delete parent — ON DELETE SET NULL orphans children gracefully
    const deleteRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/${parent.data.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)

    // Verify child still exists but parent_id is now null
    const childGetRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments/${child.data.id}`,
    )
    expect(childGetRes.status).toBe(200)
    const updatedChild = (await childGetRes.json()) as { data: CommentRow }
    expect(updatedChild.data.parent_id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Battle: multi-tenant isolation for comments
// ---------------------------------------------------------------------------

describe('comments battle — multi-tenant isolation (#276)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyAId: string
  let companyBId: string
  let issueAId: string
  let issueBId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const companyA = await createCompany(app, 'CMTA')
    companyAId = companyA.id
    const companyB = await createCompany(app, 'CMTB')
    companyBId = companyB.id

    const issueA = await createIssue(app, companyAId, 'Company A Issue')
    issueAId = issueA.id
    const issueB = await createIssue(app, companyBId, 'Company B Issue')
    issueBId = issueB.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company A cannot post a comment on company B issue via company A URL', async () => {
    // Company A scoped URL, but using company B's issueId → issue not found in company A
    const res = await postComment(app, companyAId, issueBId, {
      content: 'Cross-tenant comment attempt',
    })
    expect(res.status).toBe(404)
  })

  it('company B cannot read comments on company A issue via company B URL', async () => {
    // Create a comment on company A's issue first
    await postComment(app, companyAId, issueAId, { content: 'Company A private comment' })

    // Try to list comments using company B's scope but company A's issue ID
    const res = await app.request(
      `/api/companies/${companyBId}/issues/${issueAId}/comments`,
    )
    expect(res.status).toBe(404)
  })

  it('company A cannot PATCH a comment on company B issue via company A URL', async () => {
    // Create a real comment on company B's issue
    const createRes = await postComment(app, companyBId, issueBId, {
      content: 'Company B comment',
    })
    const created = (await createRes.json()) as { data: CommentRow }

    // Try to PATCH using company A scope
    const patchRes = await patchComment(app, companyAId, issueBId, created.data.id, {
      content: 'Hijacked content',
    })
    expect(patchRes.status).toBe(404)
  })

  it('company A cannot DELETE a comment on company B issue via company A URL', async () => {
    const createRes = await postComment(app, companyBId, issueBId, {
      content: 'Company B comment to not delete',
    })
    const created = (await createRes.json()) as { data: CommentRow }

    const deleteRes = await app.request(
      `/api/companies/${companyAId}/issues/${issueBId}/comments/${created.data.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle: pagination on comments list
// ---------------------------------------------------------------------------

describe('comments battle — pagination (#276)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'CPGN')
    companyId = company.id
    const issue = await createIssue(app, companyId, 'Pagination issue')
    issueId = issue.id

    // Seed 5 comments
    for (let i = 1; i <= 5; i++) {
      await postComment(app, companyId, issueId, { content: `Comment ${i}` })
    }
  })

  afterAll(async () => {
    await db.close()
  })

  it('?limit=2 returns only 2 comments', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments?limit=2`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow[] }
    expect(body.data.length).toBe(2)
    expect(body.data[0].content).toBe('Comment 1')
    expect(body.data[1].content).toBe('Comment 2')
  })

  it('?limit=2&offset=2 returns comments 3 and 4', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments?limit=2&offset=2`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow[] }
    expect(body.data.length).toBe(2)
    expect(body.data[0].content).toBe('Comment 3')
    expect(body.data[1].content).toBe('Comment 4')
  })

  it('?offset beyond total returns empty array', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/comments?limit=10&offset=100`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CommentRow[] }
    expect(body.data.length).toBe(0)
  })
})
