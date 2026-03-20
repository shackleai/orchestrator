/**
 * Documents Battle Test — #277
 *
 * Full coverage of the documents routes — no prior test file exists.
 * Covers all routes in apps/cli/src/server/routes/documents.ts:
 *
 * Happy Path:
 *   - Create document (title only, title+content, with agent)
 *   - GET list, GET single
 *   - PUT update → auto-creates revision on content change
 *   - GET revision history (ordered DESC by revision_number)
 *   - Link document to issue
 *   - GET documents linked to issue
 *   - Unlink document from issue
 *   - DELETE document
 *
 * Edge Cases:
 *   - Rapid sequential updates produce multiple revisions with correct numbering
 *   - Title-only update does NOT create a revision
 *   - Document linked to multiple issues
 *   - Large content (50 KB string)
 *   - Duplicate link → 409
 *
 * Error Cases:
 *   - Empty title → 400
 *   - Update non-existent document → 404
 *   - Link to non-existent issue → 404
 *   - Link non-existent document to issue → 404
 *   - GET revisions for non-existent document → 404
 *   - GET list for non-existent issue → 404
 *   - Unlink document not linked → 404
 *   - DELETE non-existent document → 404
 *   - Invalid JSON body → 400
 *
 * Multi-Tenant:
 *   - Company A cannot access company B documents
 *   - Cross-company link attempt blocked
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string }

type DocumentRow = {
  id: string
  company_id: string
  title: string
  content: string
  created_by_agent_id: string | null
  created_at: string
  updated_at: string
}

type DocumentRevisionRow = {
  id: string
  document_id: string
  content: string
  revision_number: number
  created_by_agent_id: string | null
  created_at: string
}

type IssueRow = { id: string; identifier: string; title: string }

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
    body: JSON.stringify({ name: `DocsBattle ${prefix}`, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: CompanyRow }).data
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  title = 'Test Issue',
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: IssueRow }).data
}

async function createDocument(
  app: ReturnType<typeof createApp>,
  companyId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function updateDocument(
  app: ReturnType<typeof createApp>,
  companyId: string,
  docId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/documents/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function linkDocument(
  app: ReturnType<typeof createApp>,
  companyId: string,
  issueId: string,
  documentId: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/issues/${issueId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId }),
  })
}

// ---------------------------------------------------------------------------
// Happy Path — CRUD
// ---------------------------------------------------------------------------

describe('documents battle — CRUD happy path (#277)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'DCHP')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST creates a document with title only and returns 201', async () => {
    const res = await createDocument(app, companyId, { title: 'My First Doc' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: DocumentRow }
    expect(body.data.title).toBe('My First Doc')
    expect(body.data.content).toBe('')
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.created_by_agent_id).toBeNull()
    expect(body.data.id).toBeTruthy()
  })

  it('POST creates a document with title and content', async () => {
    const res = await createDocument(app, companyId, {
      title: 'Doc with content',
      content: 'Initial content here',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: DocumentRow }
    expect(body.data.content).toBe('Initial content here')
  })

  it('GET list returns all documents ordered by updated_at DESC', async () => {
    const res = await app.request(`/api/companies/${companyId}/documents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DocumentRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    // Verify DESC order — first item should be most recently updated
    if (body.data.length > 1) {
      const first = new Date(body.data[0].updated_at).getTime()
      const second = new Date(body.data[1].updated_at).getTime()
      expect(first).toBeGreaterThanOrEqual(second)
    }
  })

  it('GET single returns a specific document', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Fetchable Doc',
      content: 'Fetchable content',
    })
    const created = (await createRes.json()) as { data: DocumentRow }
    const docId = created.data.id

    const res = await app.request(`/api/companies/${companyId}/documents/${docId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DocumentRow }
    expect(body.data.id).toBe(docId)
    expect(body.data.title).toBe('Fetchable Doc')
    expect(body.data.content).toBe('Fetchable content')
  })

  it('PUT updates title only — does NOT create a revision', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Title Only Update',
      content: 'Content unchanged',
    })
    const created = (await createRes.json()) as { data: DocumentRow }
    const docId = created.data.id

    const putRes = await updateDocument(app, companyId, docId, { title: 'Updated Title' })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { data: DocumentRow }
    expect(putBody.data.title).toBe('Updated Title')
    expect(putBody.data.content).toBe('Content unchanged')

    // No revision should have been created (content was not changed)
    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(0)
  })

  it('PUT updates content → auto-creates revision with previous content', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Revision Test',
      content: 'Version 1',
    })
    const created = (await createRes.json()) as { data: DocumentRow }
    const docId = created.data.id

    const putRes = await updateDocument(app, companyId, docId, { content: 'Version 2' })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { data: DocumentRow }
    expect(putBody.data.content).toBe('Version 2')

    // Revision should store the OLD content
    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(1)
    expect(revBody.data[0].content).toBe('Version 1')
    expect(revBody.data[0].revision_number).toBe(1)
  })

  it('GET revisions ordered by revision_number DESC', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Multi-revision Doc',
      content: 'Rev 0',
    })
    const created = (await createRes.json()) as { data: DocumentRow }
    const docId = created.data.id

    // Create 3 revisions
    await updateDocument(app, companyId, docId, { content: 'Rev 1' })
    await updateDocument(app, companyId, docId, { content: 'Rev 2' })
    await updateDocument(app, companyId, docId, { content: 'Rev 3' })

    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(3)
    // DESC order — highest revision_number first
    expect(revBody.data[0].revision_number).toBe(3)
    expect(revBody.data[1].revision_number).toBe(2)
    expect(revBody.data[2].revision_number).toBe(1)
    // Content at each revision should be the OLD content before that update
    expect(revBody.data[0].content).toBe('Rev 2')
    expect(revBody.data[1].content).toBe('Rev 1')
    expect(revBody.data[2].content).toBe('Rev 0')
  })

  it('DELETE removes document and returns { deleted: true }', async () => {
    const createRes = await createDocument(app, companyId, { title: 'Delete Me' })
    const created = (await createRes.json()) as { data: DocumentRow }
    const docId = created.data.id

    const deleteRes = await app.request(`/api/companies/${companyId}/documents/${docId}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    const body = (await deleteRes.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)

    // Verify gone
    const getRes = await app.request(`/api/companies/${companyId}/documents/${docId}`)
    expect(getRes.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Happy Path — Issue linking
// ---------------------------------------------------------------------------

describe('documents battle — issue linking (#277)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string
  let docId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'DLNK')
    companyId = company.id
    const issue = await createIssue(app, companyId, 'Link target issue')
    issueId = issue.id
    const docRes = await createDocument(app, companyId, {
      title: 'Linkable Doc',
      content: 'Content to link',
    })
    docId = ((await docRes.json()) as { data: DocumentRow }).data.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST link returns 201 with { linked: true }', async () => {
    const res = await linkDocument(app, companyId, issueId, docId)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { linked: boolean } }
    expect(body.data.linked).toBe(true)
  })

  it('GET /issues/:issueId/documents returns linked documents', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/documents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DocumentRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(docId)
    expect(body.data[0].title).toBe('Linkable Doc')
  })

  it('duplicate link returns 409', async () => {
    const res = await linkDocument(app, companyId, issueId, docId)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already linked')
  })

  it('DELETE unlink returns { unlinked: true }', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/documents/${docId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { unlinked: boolean } }
    expect(body.data.unlinked).toBe(true)

    // Verify unlinked
    const listRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/documents`,
    )
    const listBody = (await listRes.json()) as { data: DocumentRow[] }
    expect(listBody.data.length).toBe(0)
  })

  it('GET issues/:issueId/documents returns empty array when no links', async () => {
    const newIssue = await createIssue(app, companyId, 'Empty linked issue')
    const res = await app.request(
      `/api/companies/${companyId}/issues/${newIssue.id}/documents`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DocumentRow[] }
    expect(body.data.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('documents battle — edge cases (#277)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'DEDG')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('rapid sequential updates produce correctly numbered revisions', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Rapid updates',
      content: 'v0',
    })
    const docId = ((await createRes.json()) as { data: DocumentRow }).data.id

    // 5 rapid updates
    for (let i = 1; i <= 5; i++) {
      await updateDocument(app, companyId, docId, { content: `v${i}` })
    }

    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(5)

    // revision_numbers should be 5, 4, 3, 2, 1 in DESC order
    const numbers = revBody.data.map((r) => r.revision_number)
    expect(numbers).toEqual([5, 4, 3, 2, 1])
  })

  it('updating content to same value does NOT create a revision', async () => {
    const createRes = await createDocument(app, companyId, {
      title: 'Same content',
      content: 'Identical',
    })
    const docId = ((await createRes.json()) as { data: DocumentRow }).data.id

    // Update with identical content
    await updateDocument(app, companyId, docId, { content: 'Identical' })

    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(0)
  })

  it('document can be linked to multiple issues', async () => {
    const docRes = await createDocument(app, companyId, { title: 'Multi-linked Doc' })
    const docId = ((await docRes.json()) as { data: DocumentRow }).data.id

    const issueA = await createIssue(app, companyId, 'Issue A')
    const issueB = await createIssue(app, companyId, 'Issue B')
    const issueC = await createIssue(app, companyId, 'Issue C')

    await linkDocument(app, companyId, issueA.id, docId)
    await linkDocument(app, companyId, issueB.id, docId)
    await linkDocument(app, companyId, issueC.id, docId)

    // Verify each issue has the document
    for (const issue of [issueA, issueB, issueC]) {
      const res = await app.request(
        `/api/companies/${companyId}/issues/${issue.id}/documents`,
      )
      const body = (await res.json()) as { data: DocumentRow[] }
      expect(body.data.length).toBe(1)
      expect(body.data[0].id).toBe(docId)
    }
  })

  it('large content (50KB) is stored and retrieved correctly', async () => {
    const largeContent = 'x'.repeat(50_000)
    const createRes = await createDocument(app, companyId, {
      title: 'Large Document',
      content: largeContent,
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { data: DocumentRow }
    expect(created.data.content.length).toBe(50_000)

    const getRes = await app.request(
      `/api/companies/${companyId}/documents/${created.data.id}`,
    )
    const getBody = (await getRes.json()) as { data: DocumentRow }
    expect(getBody.data.content.length).toBe(50_000)
  })

  it('PUT stores updated_by_agent_id in revision metadata', async () => {
    // Insert an agent directly via DB
    const agentResult = await db.query<{ id: string }>(
      `INSERT INTO agents (company_id, name, adapter_type, adapter_config)
       VALUES ($1, 'doc-writer-bot', 'process', '{}')
       RETURNING id`,
      [companyId],
    )
    const agentId = agentResult.rows[0].id

    const createRes = await createDocument(app, companyId, {
      title: 'Agent-authored doc',
      content: 'Initial by human',
    })
    const docId = ((await createRes.json()) as { data: DocumentRow }).data.id

    await updateDocument(app, companyId, docId, {
      content: 'Revised by agent',
      updated_by_agent_id: agentId,
    })

    const revRes = await app.request(`/api/companies/${companyId}/documents/${docId}/revisions`)
    const revBody = (await revRes.json()) as { data: DocumentRevisionRow[] }
    expect(revBody.data.length).toBe(1)
    expect(revBody.data[0].created_by_agent_id).toBe(agentId)
  })
})

// ---------------------------------------------------------------------------
// Error Cases
// ---------------------------------------------------------------------------

describe('documents battle — error cases (#277)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string

  const GHOST_ID = '00000000-0000-0000-0000-000000000000'

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'DERR')
    companyId = company.id
    const issue = await createIssue(app, companyId)
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('POST with empty title returns 400', async () => {
    const res = await createDocument(app, companyId, { title: '' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST with missing title returns 400', async () => {
    const res = await createDocument(app, companyId, { content: 'No title' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST with invalid JSON returns 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET single non-existent document returns 404', async () => {
    const res = await app.request(`/api/companies/${companyId}/documents/${GHOST_ID}`)
    expect(res.status).toBe(404)
  })

  it('PUT non-existent document returns 404', async () => {
    const res = await updateDocument(app, companyId, GHOST_ID, { title: 'Ghost update' })
    expect(res.status).toBe(404)
  })

  it('PUT with invalid JSON returns 400', async () => {
    const createRes = await createDocument(app, companyId, { title: 'Valid doc' })
    const docId = ((await createRes.json()) as { data: DocumentRow }).data.id

    const res = await app.request(`/api/companies/${companyId}/documents/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    })
    expect(res.status).toBe(400)
  })

  it('DELETE non-existent document returns 404', async () => {
    const res = await app.request(`/api/companies/${companyId}/documents/${GHOST_ID}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('GET revisions for non-existent document returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/documents/${GHOST_ID}/revisions`,
    )
    expect(res.status).toBe(404)
  })

  it('POST link to non-existent issue returns 404', async () => {
    const docRes = await createDocument(app, companyId, { title: 'Real Doc' })
    const docId = ((await docRes.json()) as { data: DocumentRow }).data.id

    const res = await linkDocument(app, companyId, GHOST_ID, docId)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Issue not found')
  })

  it('POST link of non-existent document to issue returns 404', async () => {
    const res = await linkDocument(app, companyId, issueId, GHOST_ID)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Document not found')
  })

  it('GET linked documents for non-existent issue returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${GHOST_ID}/documents`,
    )
    expect(res.status).toBe(404)
  })

  it('DELETE unlink of document not currently linked returns 404', async () => {
    const docRes = await createDocument(app, companyId, { title: 'Not linked doc' })
    const docId = ((await docRes.json()) as { data: DocumentRow }).data.id

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/documents/${docId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not linked')
  })

  it('POST link with missing document_id returns 400', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST with non-existent created_by_agent_id returns 404', async () => {
    const res = await createDocument(app, companyId, {
      title: 'Agent-attributed doc',
      created_by_agent_id: GHOST_ID,
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Agent not found')
  })
})

// ---------------------------------------------------------------------------
// Multi-Tenant Isolation
// ---------------------------------------------------------------------------

describe('documents battle — multi-tenant isolation (#277)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyAId: string
  let companyBId: string
  let docAId: string
  let issueAId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const companyA = await createCompany(app, 'DMTA')
    companyAId = companyA.id
    const companyB = await createCompany(app, 'DMTB')
    companyBId = companyB.id

    const docRes = await createDocument(app, companyAId, {
      title: 'Company A Private Doc',
      content: 'Secret',
    })
    docAId = ((await docRes.json()) as { data: DocumentRow }).data.id

    const issue = await createIssue(app, companyAId, 'Company A Issue')
    issueAId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company B cannot GET company A document', async () => {
    const res = await app.request(`/api/companies/${companyBId}/documents/${docAId}`)
    expect(res.status).toBe(404)
  })

  it('company B cannot update company A document', async () => {
    const res = await updateDocument(app, companyBId, docAId, { title: 'Hijacked title' })
    expect(res.status).toBe(404)
  })

  it('company B cannot delete company A document', async () => {
    const res = await app.request(`/api/companies/${companyBId}/documents/${docAId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('company B cannot view revisions of company A document', async () => {
    const res = await app.request(
      `/api/companies/${companyBId}/documents/${docAId}/revisions`,
    )
    expect(res.status).toBe(404)
  })

  it('company B cannot link company A document to company A issue', async () => {
    // Company B scope — issue belongs to company A, should be 404
    const res = await linkDocument(app, companyBId, issueAId, docAId)
    expect(res.status).toBe(404)
  })

  it('company A document does not appear in company B document list', async () => {
    const res = await app.request(`/api/companies/${companyBId}/documents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DocumentRow[] }
    const found = body.data.find((d) => d.id === docAId)
    expect(found).toBeUndefined()
  })
})
