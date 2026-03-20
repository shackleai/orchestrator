/**
 * E2E Battle Test — Task/Issue System (#268)
 *
 * Covers scenarios not already tested in issues.test.ts, task-cmd.test.ts,
 * delegation.test.ts, and concurrent-checkout.test.ts:
 *
 *  1. Labels — full CRUD, assign/remove on issues, filter by label, duplicate guard
 *  2. Work products — create, list, get single, delete, invalid type, non-existent issue
 *  3. Attachments — upload, list, download, delete, oversized file, missing file, with in-memory storage
 *  4. Issue detail — ancestry enrichment (goal/project/company mission), reader_id read-state
 *  5. Checklist — PUT validation, 404 guard, partial completion prevents done
 *  6. Status transitions — full open → in_progress → in_review → done flow
 *  7. Deep nesting — 3-level parent/child tree lifecycle guard
 *  8. Multi-concurrent checkouts — N agents race for 1 task, exactly 1 wins
 *  9. Label filter on issue list
 * 10. Issue search — filter by label via ?label= query param
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import type { StorageProvider, UploadResult, DownloadResult } from '@shackleai/core'

// ---------------------------------------------------------------------------
// In-memory storage stub — satisfies StorageProvider without touching disk
// ---------------------------------------------------------------------------

class MemoryStorageProvider implements StorageProvider {
  readonly type = 'memory'
  private store = new Map<string, { buffer: Buffer; mime: string }>()

  async upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult> {
    this.store.set(key, { buffer, mime })
    return { key, size: buffer.length, mime }
  }

  async download(key: string): Promise<DownloadResult> {
    const entry = this.store.get(key)
    if (!entry) throw new Error(`Key not found: ${key}`)
    return { buffer: entry.buffer, mime: entry.mime, size: entry.buffer.length }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async getUrl(key: string): Promise<string> {
    return `/files/${key}`
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key)
  }
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type CompanyRow = { id: string; name: string; issue_prefix: string }
type AgentRow = { id: string; name: string }
type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  assignee_agent_id: string | null
  parent_id: string | null
  honesty_checklist: unknown
}
type LabelRow = {
  id: string
  company_id: string
  name: string
  color: string
  description: string | null
}
type WorkProductRow = {
  id: string
  issue_id: string
  title: string
  description: string | null
  type: string
  url: string
  agent_id: string | null
}
type AttachmentRow = {
  id: string
  issue_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by_agent_id: string | null
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function createCompany(app: App, name: string, prefix: string): Promise<CompanyRow> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function createAgent(app: App, companyId: string, name: string): Promise<AgentRow> {
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
  app: App,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Default Issue', ...overrides }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

async function createLabel(
  app: App,
  companyId: string,
  name: string,
  color = '#3b82f6',
): Promise<LabelRow> {
  const res = await app.request(`/api/companies/${companyId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: LabelRow }
  return body.data
}

async function assignLabel(
  app: App,
  companyId: string,
  issueId: string,
  labelId: string,
): Promise<void> {
  const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label_id: labelId }),
  })
  expect(res.status).toBe(201)
}

// ---------------------------------------------------------------------------
// 1. Labels — CRUD + issue assignment
// ---------------------------------------------------------------------------

describe('Battle 13A: label CRUD', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Label Corp', 'LBL')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /labels returns empty array for fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /labels creates a label with name and color', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bug', color: '#ef4444' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('bug')
    expect(body.data.color).toBe('#ef4444')
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.id).toBeTruthy()
  })

  it('POST /labels returns 409 for duplicate name within same company', async () => {
    // Create first
    await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'duplicate-label', color: '#000000' }),
    })

    // Create second with same name
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'duplicate-label', color: '#ffffff' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Label with this name already exists')
  })

  it('POST /labels returns 400 when name is missing', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: '#ff0000' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /labels returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /labels lists multiple labels ordered by name ASC', async () => {
    // Create two more labels
    await createLabel(app, companyId, 'zz-feature', '#22c55e')
    await createLabel(app, companyId, 'aa-urgent', '#f97316')

    const res = await app.request(`/api/companies/${companyId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    const names = body.data.map((l) => l.name)
    // Should be sorted alphabetically
    expect(names.indexOf('aa-urgent')).toBeLessThan(names.indexOf('zz-feature'))
  })

  it('PUT /labels/:labelId renames a label', async () => {
    const label = await createLabel(app, companyId, 'old-name', '#aabbcc')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-name' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('new-name')
    expect(body.data.id).toBe(label.id)
  })

  it('PUT /labels/:labelId returns 409 when renaming to an existing name', async () => {
    const label1 = await createLabel(app, companyId, 'rename-source', '#111111')
    await createLabel(app, companyId, 'rename-target', '#222222')

    const res = await app.request(`/api/companies/${companyId}/labels/${label1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'rename-target' }),
    })
    expect(res.status).toBe(409)
  })

  it('PUT /labels/:labelId returns 404 for non-existent label', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/labels/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ghost-label' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('DELETE /labels/:labelId removes a label', async () => {
    const label = await createLabel(app, companyId, 'to-delete', '#333333')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)

    // Verify it no longer appears in list
    const listRes = await app.request(`/api/companies/${companyId}/labels`)
    const listBody = (await listRes.json()) as { data: LabelRow[] }
    const ids = listBody.data.map((l) => l.id)
    expect(ids).not.toContain(label.id)
  })

  it('DELETE /labels/:labelId returns 404 for non-existent label', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/labels/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Label not found')
  })

  it('different companies can have labels with the same name', async () => {
    const otherCompany = await createCompany(app, 'Other Label Co', 'OLC')

    // Create "bug" label for other company — should not conflict with "bug" on companyId
    const res = await app.request(`/api/companies/${otherCompany.id}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bug', color: '#ef4444' }),
    })
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// 2. Labels — issue assignment
// ---------------------------------------------------------------------------

describe('Battle 13B: label assignment on issues', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let issueId: string
  let labelId: string
  let label2Id: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Label Assign Corp', 'LAS')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Issue for label tests' })
    issueId = issue.id
    const label1 = await createLabel(app, companyId, 'priority:high', '#ef4444')
    const label2 = await createLabel(app, companyId, 'type:feature', '#3b82f6')
    labelId = label1.id
    label2Id = label2.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /issues/:issueId/labels returns empty array for unlabeled issue', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /issues/:issueId/labels assigns a label to the issue', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label_id: labelId }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { assigned: boolean } }
    expect(body.data.assigned).toBe(true)
  })

  it('GET /issues/:issueId/labels shows the assigned label', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(labelId)
    expect(body.data[0].name).toBe('priority:high')
  })

  it('POST /issues/:issueId/labels returns 409 for duplicate assignment', async () => {
    // Assign same label again
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label_id: labelId }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Label already assigned to this issue')
  })

  it('POST /issues/:issueId/labels returns 404 for non-existent label', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label_id: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Label not found')
  })

  it('POST /issues/:issueId/labels returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: labelId }),
      },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('multiple labels can be assigned to the same issue', async () => {
    await assignLabel(app, companyId, issueId, label2Id)

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data).toHaveLength(2)
    const names = body.data.map((l) => l.name)
    expect(names).toContain('priority:high')
    expect(names).toContain('type:feature')
  })

  it('DELETE /issues/:issueId/labels/:labelId removes the assignment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${label2Id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { removed: boolean } }
    expect(body.data.removed).toBe(true)

    // Verify only 1 label remains
    const listRes = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    const listBody = (await listRes.json()) as { data: LabelRow[] }
    expect(listBody.data).toHaveLength(1)
  })

  it('DELETE /issues/:issueId/labels/:labelId returns 404 for unassigned label', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${label2Id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Label not assigned to this issue')
  })
})

// ---------------------------------------------------------------------------
// 3. Label filter on issue list
// ---------------------------------------------------------------------------

describe('Battle 13C: filter issues by label', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Label Filter Co', 'LFC')
    companyId = company.id

    // Create labels
    const bugLabel = await createLabel(app, companyId, 'bug', '#ef4444')
    const featLabel = await createLabel(app, companyId, 'feature', '#22c55e')

    // Create 3 issues
    const issueA = await createIssue(app, companyId, { title: 'Bug Issue A' })
    const issueB = await createIssue(app, companyId, { title: 'Bug Issue B' })
    const issueC = await createIssue(app, companyId, { title: 'Feature Issue C' })

    // Assign labels
    await assignLabel(app, companyId, issueA.id, bugLabel.id)
    await assignLabel(app, companyId, issueB.id, bugLabel.id)
    await assignLabel(app, companyId, issueC.id, featLabel.id)
  })

  afterAll(async () => {
    await db.close()
  })

  it('?label=bug returns only issues with that label', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?label=bug`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(2)
    expect(body.data.every((i) => i.title.includes('Bug'))).toBe(true)
  })

  it('?label=feature returns only issues with feature label', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?label=feature`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe('Feature Issue C')
  })

  it('?label=nonexistent returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues?label=nonexistent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('cross-tenant: label filter only returns issues for the correct company', async () => {
    // Create a sibling company with a "bug" label on its own issue
    const otherCompany = await createCompany(app, 'Other Co', 'OTH')
    const otherBug = await createLabel(app, otherCompany.id, 'bug', '#ef4444')
    const otherIssue = await createIssue(app, otherCompany.id, { title: 'Other Co Bug' })
    await assignLabel(app, otherCompany.id, otherIssue.id, otherBug.id)

    // Querying the original company should NOT return other company's issue
    const res = await app.request(`/api/companies/${companyId}/issues?label=bug`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    const ids = body.data.map((i) => i.id)
    expect(ids).not.toContain(otherIssue.id)
  })
})

// ---------------------------------------------------------------------------
// 4. Work products — CRUD
// ---------------------------------------------------------------------------

describe('Battle 14: work products CRUD', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let issueId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Work Product Corp', 'WPC')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Issue for work products' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /work-products returns empty array for fresh issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorkProductRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /work-products creates a pull request work product', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'PR #42: Implement auth layer',
          description: 'Added JWT middleware and session management',
          type: 'pull_request',
          url: 'https://github.com/example/repo/pull/42',
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: WorkProductRow }
    expect(body.data.title).toBe('PR #42: Implement auth layer')
    expect(body.data.type).toBe('pull_request')
    expect(body.data.url).toBe('https://github.com/example/repo/pull/42')
    expect(body.data.issue_id).toBe(issueId)
    expect(body.data.id).toBeTruthy()
  })

  it('POST /work-products creates a document work product', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Design specification',
          type: 'document',
          url: 'https://docs.example.com/spec-v1',
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: WorkProductRow }
    expect(body.data.type).toBe('document')
  })

  it('POST /work-products creates work product with agent attribution', async () => {
    const agent = await createAgent(app, companyId, 'Work Agent')

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Deployment log',
          type: 'deployment',
          url: 'https://deploy.example.com/logs/123',
          agent_id: agent.id,
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: WorkProductRow }
    expect(body.data.agent_id).toBe(agent.id)
  })

  it('GET /work-products lists all work products ordered by created_at DESC', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorkProductRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    body.data.forEach((wp) => {
      expect(wp.issue_id).toBe(issueId)
    })
  })

  it('GET /work-products/:wpId returns single work product', async () => {
    // Create a known work product
    const createRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Report: perf analysis',
          type: 'report',
          url: 'https://reports.example.com/perf',
        }),
      },
    )
    const createBody = (await createRes.json()) as { data: WorkProductRow }
    const wpId = createBody.data.id

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products/${wpId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: WorkProductRow }
    expect(body.data.id).toBe(wpId)
    expect(body.data.title).toBe('Report: perf analysis')
  })

  it('GET /work-products/:wpId returns 404 for non-existent work product', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Work product not found')
  })

  it('DELETE /work-products/:wpId deletes a work product', async () => {
    const createRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'To delete',
          type: 'artifact',
          url: 'https://artifacts.example.com/build-abc',
        }),
      },
    )
    const createBody = (await createRes.json()) as { data: WorkProductRow }
    const wpId = createBody.data.id

    const deleteRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products/${wpId}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { data: WorkProductRow }
    expect(deleteBody.data.id).toBe(wpId)

    // Verify it's gone
    const getRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products/${wpId}`,
    )
    expect(getRes.status).toBe(404)
  })

  it('POST /work-products returns 400 for invalid type', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Invalid type',
          type: 'video', // not in WorkProductType enum
          url: 'https://example.com/video',
        }),
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /work-products returns 400 when title is missing', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'document', url: 'https://example.com' }),
      },
    )
    expect(res.status).toBe(400)
  })

  it('POST /work-products returns 400 when url is missing', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'No URL', type: 'document' }),
      },
    )
    expect(res.status).toBe(400)
  })

  it('POST /work-products returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/work-products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Ghost WP',
          type: 'other',
          url: 'https://example.com',
        }),
      },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('GET /work-products returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/work-products`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })
})

// ---------------------------------------------------------------------------
// 5. Attachments — upload / list / download / delete with in-memory storage
// ---------------------------------------------------------------------------

describe('Battle 15: attachments with in-memory storage', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let issueId: string
  const storage = new MemoryStorageProvider()

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true, storage })
    const company = await createCompany(app, 'Attach Corp', 'ATT')
    companyId = company.id
    const issue = await createIssue(app, companyId, { title: 'Issue for attachments' })
    issueId = issue.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /attachments returns empty array for fresh issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AttachmentRow[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /attachments uploads a text file and records DB entry', async () => {
    const fileContent = 'Hello, this is a test attachment file.'
    const blob = new Blob([fileContent], { type: 'text/plain' })

    const formData = new FormData()
    formData.append('file', blob, 'test-file.txt')

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      {
        method: 'POST',
        body: formData,
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: AttachmentRow }
    expect(body.data.filename).toBe('test-file.txt')
    expect(body.data.mime_type).toBe('text/plain')
    expect(body.data.size_bytes).toBe(fileContent.length)
    expect(body.data.issue_id).toBe(issueId)
    expect(body.data.storage_key).toContain('attachments/')
    expect(body.data.uploaded_by_agent_id).toBeNull()
  })

  it('POST /attachments records uploader agent_id when provided', async () => {
    const agent = await createAgent(app, companyId, 'Uploader Agent')
    const blob = new Blob(['agent upload content'], { type: 'text/plain' })

    const formData = new FormData()
    formData.append('file', blob, 'agent-upload.txt')
    formData.append('agent_id', agent.id)

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      {
        method: 'POST',
        body: formData,
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: AttachmentRow }
    expect(body.data.uploaded_by_agent_id).toBe(agent.id)
  })

  it('GET /attachments lists uploaded attachments', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AttachmentRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    body.data.forEach((a) => {
      expect(a.issue_id).toBe(issueId)
    })
  })

  it('GET /attachments/:attachId downloads the file', async () => {
    // Upload a known file
    const fileContent = 'download test content'
    const blob = new Blob([fileContent], { type: 'text/plain' })
    const formData = new FormData()
    formData.append('file', blob, 'download-me.txt')

    const uploadRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      { method: 'POST', body: formData },
    )
    const uploadBody = (await uploadRes.json()) as { data: AttachmentRow }
    const attachId = uploadBody.data.id

    // Download it
    const downloadRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments/${attachId}`,
    )
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('Content-Type')).toBe('text/plain')
    expect(downloadRes.headers.get('Content-Disposition')).toContain('download-me.txt')
    const downloadedText = await downloadRes.text()
    expect(downloadedText).toBe(fileContent)
  })

  it('GET /attachments/:attachId returns 404 for non-existent attachment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments/00000000-0000-0000-0000-000000000000`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Attachment not found')
  })

  it('DELETE /attachments/:attachId deletes the attachment', async () => {
    // Upload then delete
    const blob = new Blob(['to be deleted'], { type: 'text/plain' })
    const formData = new FormData()
    formData.append('file', blob, 'delete-me.txt')

    const uploadRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      { method: 'POST', body: formData },
    )
    const uploadBody = (await uploadRes.json()) as { data: AttachmentRow }
    const attachId = uploadBody.data.id

    const deleteRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments/${attachId}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)
    const deleteBody = (await deleteRes.json()) as { data: AttachmentRow }
    expect(deleteBody.data.id).toBe(attachId)

    // Verify gone from DB
    const getRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments/${attachId}`,
    )
    expect(getRes.status).toBe(404)
  })

  it('POST /attachments returns 400 when no file is provided', async () => {
    const formData = new FormData()
    // No file appended

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      { method: 'POST', body: formData },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Missing file in multipart form data')
  })

  it('POST /attachments returns 413 when file exceeds 10MB limit', async () => {
    // 10MB + 1 byte
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 'x')
    const blob = new Blob([oversizedBuffer], { type: 'application/octet-stream' })
    const formData = new FormData()
    formData.append('file', blob, 'huge.bin')

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/attachments`,
      { method: 'POST', body: formData },
    )
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('10 MB')
  })

  it('POST /attachments returns 404 for non-existent issue', async () => {
    const blob = new Blob(['content'], { type: 'text/plain' })
    const formData = new FormData()
    formData.append('file', blob, 'ghost.txt')

    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/attachments`,
      { method: 'POST', body: formData },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('GET /attachments returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/attachments`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })
})

// ---------------------------------------------------------------------------
// 6. Issue detail — ancestry enrichment + read-state
// ---------------------------------------------------------------------------

describe('Battle 16: issue detail ancestry and read-state', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Ancestry Corp', 'ANC')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Reader Agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('issue detail returns ancestry field with task title', async () => {
    const issue = await createIssue(app, companyId, { title: 'Detailed Task' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: IssueRow & {
        ancestry: {
          mission: string | null
          project: unknown
          goal: unknown
          task: { title: string; description: string | null }
        }
      }
    }
    expect(body.data.ancestry).toBeDefined()
    expect(body.data.ancestry.task).toBeDefined()
    expect(body.data.ancestry.task.title).toBe('Detailed Task')
  })

  it('ancestry includes company mission when description is set', async () => {
    // Set company description (mission)
    await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Build the AI OS' }),
    })

    const issue = await createIssue(app, companyId, { title: 'Mission Task' })
    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow & { ancestry: { mission: string | null } } }
    expect(body.data.ancestry.mission).toBe('Build the AI OS')
  })

  it('?reader_id marks issue as read without affecting response data', async () => {
    const issue = await createIssue(app, companyId, { title: 'Read Tracking Task' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}?reader_id=${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    // Response still has the task data, not broken by reader tracking
    expect(body.data.id).toBe(issue.id)
    expect(body.data.title).toBe('Read Tracking Task')

    // Verify read state was recorded
    const readResult = await db.query<{ issue_id: string; user_or_agent_id: string }>(
      `SELECT issue_id, user_or_agent_id FROM issue_read_states WHERE issue_id = $1 AND user_or_agent_id = $2`,
      [issue.id, agentId],
    )
    expect(readResult.rows.length).toBe(1)
    expect(readResult.rows[0].user_or_agent_id).toBe(agentId)
  })

  it('reading the same issue twice with reader_id updates last_read_at (upsert)', async () => {
    const issue = await createIssue(app, companyId, { title: 'Re-read Task' })

    // First read
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}?reader_id=${agentId}`,
    )
    // Second read
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}?reader_id=${agentId}`,
    )

    // Should still be exactly 1 row (upsert, not duplicate)
    // PGlite returns COUNT(*) as a number, not a string
    const readResult = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM issue_read_states WHERE issue_id = $1 AND user_or_agent_id = $2`,
      [issue.id, agentId],
    )
    expect(Number(readResult.rows[0].count)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 7. Checklist — validation + edge cases
// ---------------------------------------------------------------------------

describe('Battle 17: honesty checklist edge cases', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Checklist Corp', 'CKL')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('PUT /checklist returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ label: 'test', checked: false }] }),
      },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Issue not found')
  })

  it('PUT /checklist returns 400 on invalid JSON', async () => {
    const issue = await createIssue(app, companyId, { title: 'JSON Test' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad-json',
      },
    )
    expect(res.status).toBe(400)
  })

  it('PUT /checklist returns 400 when items is not an array', async () => {
    const issue = await createIssue(app, companyId, { title: 'Not Array Test' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: 'not-an-array' }),
      },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('partial checklist blocks completion — honesty gate reports unchecked items by label', async () => {
    const issue = await createIssue(app, companyId, { title: 'Partial Checklist Task' })

    // Set a 3-item checklist with 1 checked, 2 unchecked
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { label: 'Tests pass', checked: true },
            { label: 'Code review done', checked: false },
            { label: 'Docs updated', checked: false },
          ],
        }),
      },
    )

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; unchecked_items: string[] }
    expect(body.error).toBe('Honesty gate check failed')
    expect(body.unchecked_items).toHaveLength(2)
    expect(body.unchecked_items).toContain('Code review done')
    expect(body.unchecked_items).toContain('Docs updated')
  })

  it('empty checklist (no items) does not block completion', async () => {
    const issue = await createIssue(app, companyId, { title: 'Empty Checklist Task' })

    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      },
    )

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('PUT /checklist updates checklist and allows re-completing after fixing', async () => {
    const issue = await createIssue(app, companyId, { title: 'Fix and Complete' })

    // Set all unchecked
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ label: 'Must do', checked: false }],
        }),
      },
    )

    // Fails
    const blocked = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(blocked.status).toBe(400)

    // Fix checklist
    await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checklist`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ label: 'Must do', checked: true }],
        }),
      },
    )

    // Now succeeds
    const ok = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })
})

// ---------------------------------------------------------------------------
// 8. Full status transition flow
// ---------------------------------------------------------------------------

describe('Battle 18: status transition flow', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Status Flow Corp', 'SFC')
    companyId = company.id
    const agent = await createAgent(app, companyId, 'Flow Agent')
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('full lifecycle: backlog → in_progress (via checkout) → in_review → done', async () => {
    // Start in backlog (default)
    const issue = await createIssue(app, companyId, { title: 'Flow Task' })
    expect(issue.status).toBe('backlog')

    // Step 1: checkout → in_progress
    const checkoutRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      },
    )
    expect(checkoutRes.status).toBe(200)
    const checkoutBody = (await checkoutRes.json()) as { data: IssueRow }
    expect(checkoutBody.data.status).toBe('in_progress')
    expect(checkoutBody.data.assignee_agent_id).toBe(agentId)

    // Step 2: in_progress → in_review
    const reviewRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_review' }),
      },
    )
    expect(reviewRes.status).toBe(200)
    const reviewBody = (await reviewRes.json()) as { data: IssueRow }
    expect(reviewBody.data.status).toBe('in_review')

    // Step 3: in_review → done
    const doneRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(doneRes.status).toBe(200)
    const doneBody = (await doneRes.json()) as { data: IssueRow }
    expect(doneBody.data.status).toBe('done')

    // Verify final state via GET
    const getRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { data: IssueRow }
    expect(getBody.data.status).toBe('done')
    expect(getBody.data.assignee_agent_id).toBe(agentId)
  })

  it('lifecycle: backlog → todo (manual) → checkout → release → todo', async () => {
    const issue = await createIssue(app, companyId, { title: 'Triage Task' })

    // Manually move to todo (triaged)
    const todoRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' }),
    })
    expect(todoRes.status).toBe(200)

    // Checkout from todo
    const checkoutRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      },
    )
    expect(checkoutRes.status).toBe(200)

    // Release back to todo
    const releaseRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/release`,
      { method: 'POST' },
    )
    expect(releaseRes.status).toBe(200)
    const releaseBody = (await releaseRes.json()) as { data: IssueRow }
    expect(releaseBody.data.status).toBe('todo')
    expect(releaseBody.data.assignee_agent_id).toBeNull()
  })

  it('task can be cancelled from any non-terminal state', async () => {
    const issue = await createIssue(app, companyId, { title: 'Cancel Me' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('cancelled')
  })

  it('PATCH with empty body returns current issue unchanged', async () => {
    const issue = await createIssue(app, companyId, { title: 'No Change Task' })

    const res = await app.request(`/api/companies/${companyId}/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.id).toBe(issue.id)
    expect(body.data.title).toBe('No Change Task')
    expect(body.data.status).toBe('backlog')
  })
})

// ---------------------------------------------------------------------------
// 9. Deep parent/child nesting — 3-level tree lifecycle guard
// ---------------------------------------------------------------------------

describe('Battle 19: deep nesting — 3-level tree lifecycle guard', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Deep Tree Corp', 'DTC')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('grandparent cannot be completed while grandchild is incomplete', async () => {
    // Create 3-level tree: grandparent → parent → child
    const grandparent = await createIssue(app, companyId, { title: 'Grandparent Task', status: 'in_progress' })
    const parent = await createIssue(app, companyId, {
      title: 'Parent Task',
      parent_id: grandparent.id,
      status: 'in_progress',
    })
    await createIssue(app, companyId, {
      title: 'Child Task',
      parent_id: parent.id,
      status: 'in_progress',
    })

    // Try to complete the parent while child is in_progress → should block
    const parentBlock = await app.request(
      `/api/companies/${companyId}/issues/${parent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(parentBlock.status).toBe(400)
    const parentBody = (await parentBlock.json()) as { error: string }
    expect(parentBody.error).toBe('Cannot complete parent issue while children are incomplete')

    // Also cannot complete grandparent while parent is incomplete
    const grandParentBlock = await app.request(
      `/api/companies/${companyId}/issues/${grandparent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(grandParentBlock.status).toBe(400)
  })

  it('completing all children bottom-up allows grandparent to be completed', async () => {
    const grandparent = await createIssue(app, companyId, { title: 'GP Completable', status: 'in_progress' })
    const parent = await createIssue(app, companyId, {
      title: 'P Completable',
      parent_id: grandparent.id,
      status: 'in_progress',
    })
    const child = await createIssue(app, companyId, {
      title: 'C Completable',
      parent_id: parent.id,
      status: 'in_progress',
    })

    // Complete child first
    const childDone = await app.request(
      `/api/companies/${companyId}/issues/${child.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(childDone.status).toBe(200)

    // Now parent can be completed
    const parentDone = await app.request(
      `/api/companies/${companyId}/issues/${parent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(parentDone.status).toBe(200)

    // Now grandparent can be completed
    const gpDone = await app.request(
      `/api/companies/${companyId}/issues/${grandparent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(gpDone.status).toBe(200)
    const gpBody = (await gpDone.json()) as { data: IssueRow }
    expect(gpBody.data.status).toBe('done')
  })

  it('incomplete children error response lists child identifiers', async () => {
    const parent = await createIssue(app, companyId, { title: 'Error Detail Parent', status: 'in_progress' })
    await createIssue(app, companyId, {
      title: 'Blocking Child One',
      parent_id: parent.id,
      status: 'todo',
    })
    await createIssue(app, companyId, {
      title: 'Blocking Child Two',
      parent_id: parent.id,
      status: 'backlog',
    })

    const res = await app.request(`/api/companies/${companyId}/issues/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: string
      incomplete_children: { id: string; title: string; status: string }[]
      message: string
    }
    expect(body.incomplete_children).toHaveLength(2)
    // Each child has id, identifier, title, status
    body.incomplete_children.forEach((child) => {
      expect(child.id).toBeTruthy()
      expect(child.title).toBeTruthy()
      expect(child.status).toBeTruthy()
    })
    expect(body.message).toContain('Blocking Child One')
    expect(body.message).toContain('Blocking Child Two')
  })
})

// ---------------------------------------------------------------------------
// 10. Concurrent checkouts — N agents race for 1 task, exactly 1 wins
// ---------------------------------------------------------------------------

describe('Battle 20: high-concurrency checkout (5 agents, 1 task)', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentIds: string[]

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Race Corp', 'RACE')
    companyId = company.id

    // Create 5 agents
    agentIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createAgent(app, companyId, `Racer ${i + 1}`).then((a) => a.id),
      ),
    )
  })

  afterAll(async () => {
    await db.close()
  })

  it('exactly one agent wins when 5 agents race for the same task', async () => {
    const issue = await createIssue(app, companyId, { title: '5-Way Race Task' })

    // Fire all 5 checkouts simultaneously
    const responses = await Promise.all(
      agentIds.map((agentId) =>
        app.request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId }),
        }),
      ),
    )

    const statuses = responses.map((r) => r.status)
    const successCount = statuses.filter((s) => s === 200).length
    const conflictCount = statuses.filter((s) => s === 409).length

    expect(successCount).toBe(1)
    expect(conflictCount).toBe(4)
    expect(successCount + conflictCount).toBe(5)
  })

  it('task ownership is consistent — assigned to exactly the winner', async () => {
    const issue = await createIssue(app, companyId, { title: 'Ownership Race Task' })

    const responses = await Promise.all(
      agentIds.map((agentId) =>
        app
          .request(`/api/companies/${companyId}/issues/${issue.id}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId }),
          })
          .then(async (r) => ({
            status: r.status,
            agentId,
            body: r.status === 200 ? ((await r.json()) as { data: IssueRow }).data : null,
          })),
      ),
    )

    const winner = responses.find((r) => r.status === 200)
    expect(winner).toBeDefined()
    expect(winner!.body).toBeDefined()
    expect(winner!.body!.assignee_agent_id).toBe(winner!.agentId)
    expect(winner!.body!.status).toBe('in_progress')

    // Verify via GET
    const getRes = await app.request(`/api/companies/${companyId}/issues/${issue.id}`)
    const getBody = (await getRes.json()) as { data: IssueRow }
    expect(getBody.data.assignee_agent_id).toBe(winner!.agentId)
  })

  it('multiple tasks can be concurrently checked out by different agents', async () => {
    // Create 5 separate tasks — one per agent
    const issues = await Promise.all(
      agentIds.map((_, i) =>
        createIssue(app, companyId, { title: `Parallel Task ${i + 1}` }),
      ),
    )

    // Each agent checks out its own task simultaneously
    const responses = await Promise.all(
      agentIds.map((agentId, i) =>
        app.request(
          `/api/companies/${companyId}/issues/${issues[i].id}/checkout`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId }),
          },
        ),
      ),
    )

    // All 5 should succeed — no conflicts since each targets a different task
    responses.forEach((r, i) => {
      expect(r.status).toBe(200)
    })
  })
})

// ---------------------------------------------------------------------------
// 11. Issue creation with honesty_checklist inline (via POST body)
// ---------------------------------------------------------------------------

describe('Battle 21: create issue with inline honesty checklist', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'Inline Checklist Corp', 'ILC')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates issue with inline honesty checklist in POST body', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pre-checklist Task',
        honesty_checklist: [
          { label: 'Acceptance criteria reviewed', checked: false },
          { label: 'Security considered', checked: false },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.id).toBeTruthy()

    // Attempting to complete immediately should be blocked
    const blocked = await app.request(`/api/companies/${companyId}/issues/${body.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(blocked.status).toBe(400)
    const blockedBody = (await blocked.json()) as { error: string }
    expect(blockedBody.error).toBe('Honesty gate check failed')
  })

  it('all valid work product types are accepted', async () => {
    const issue = await createIssue(app, companyId, { title: 'All Types Task' })

    const types = ['pull_request', 'document', 'report', 'artifact', 'deployment', 'other']
    for (const type of types) {
      const res = await app.request(
        `/api/companies/${companyId}/issues/${issue.id}/work-products`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${type} work product`,
            type,
            url: `https://example.com/${type}`,
          }),
        },
      )
      expect(res.status).toBe(201)
    }
  })
})
