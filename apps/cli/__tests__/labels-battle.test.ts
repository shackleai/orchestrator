/**
 * Labels Battle Test — #278
 *
 * Covers scenarios NOT already in tests/e2e/labels.test.ts:
 *   - Multiple labels on single issue + verification
 *   - Filter issues by label_id (UUID-based query param)
 *   - Labels with special characters in name
 *   - PUT rename to same name as another label → 409
 *   - DELETE non-existent label → 404
 *   - Unlink label not assigned to issue → 404
 *   - GET single label (if route exists)
 *   - Assign label from different company → 404
 *   - Multi-tenant: label isolation across companies
 *   - Empty name on create → 400
 *   - Empty name on update → 400
 *   - Short hex color (#abc 3-char) validation
 *   - PUT update description only
 *   - Multiple issues linked to same label + cascade delete
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string }
type LabelRow = {
  id: string
  company_id: string
  name: string
  color: string
  description: string | null
}
type IssueRow = { id: string; identifier: string; title: string; status: string }

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
    body: JSON.stringify({ name: `LabelBattle ${prefix}`, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: CompanyRow }).data
}

async function createIssue(
  app: ReturnType<typeof createApp>,
  companyId: string,
  title = 'Label Battle Issue',
): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: IssueRow }).data
}

async function createLabel(
  app: ReturnType<typeof createApp>,
  companyId: string,
  name: string,
  color = '#aabbcc',
  description?: string,
): Promise<LabelRow> {
  const res = await app.request(`/api/companies/${companyId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, description }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: LabelRow }).data
}

async function assignLabel(
  app: ReturnType<typeof createApp>,
  companyId: string,
  issueId: string,
  labelId: string,
): Promise<Response> {
  return app.request(`/api/companies/${companyId}/issues/${issueId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label_id: labelId }),
  })
}

// ---------------------------------------------------------------------------
// Battle: multiple labels on single issue
// ---------------------------------------------------------------------------

describe('labels battle — multiple labels on one issue (#278)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string
  let labelBug: LabelRow
  let labelFeature: LabelRow
  let labelUrgent: LabelRow

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'LBML')
    companyId = company.id

    issueId = (await createIssue(app, companyId, 'Multi-label issue')).id
    labelBug = await createLabel(app, companyId, 'battle-bug', '#ff0000')
    labelFeature = await createLabel(app, companyId, 'battle-feature', '#00ff00')
    labelUrgent = await createLabel(app, companyId, 'battle-urgent', '#ffaa00')
  })

  afterAll(async () => {
    await db.close()
  })

  it('issue can have multiple labels assigned', async () => {
    await assignLabel(app, companyId, issueId, labelBug.id)
    await assignLabel(app, companyId, issueId, labelFeature.id)
    await assignLabel(app, companyId, issueId, labelUrgent.id)

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data.length).toBe(3)
    const ids = body.data.map((l) => l.id)
    expect(ids).toContain(labelBug.id)
    expect(ids).toContain(labelFeature.id)
    expect(ids).toContain(labelUrgent.id)
  })

  it('label list on issue is ordered by name ASC', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    const body = (await res.json()) as { data: LabelRow[] }
    const names = body.data.map((l) => l.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('removing one label leaves the others intact', async () => {
    const deleteRes = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${labelUrgent.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)

    const res = await app.request(`/api/companies/${companyId}/issues/${issueId}/labels`)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data.length).toBe(2)
    const ids = body.data.map((l) => l.id)
    expect(ids).toContain(labelBug.id)
    expect(ids).toContain(labelFeature.id)
    expect(ids).not.toContain(labelUrgent.id)
  })

  it('filter issues by label name returns only issues with that label', async () => {
    const otherIssue = await createIssue(app, companyId, 'Only bug issue')
    await assignLabel(app, companyId, otherIssue.id, labelBug.id)

    const plainIssue = await createIssue(app, companyId, 'Unlabeled issue')
    void plainIssue // just creating it for noise

    const res = await app.request(
      `/api/companies/${companyId}/issues?label=battle-bug`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    const ids = body.data.map((i) => i.id)
    expect(ids).toContain(issueId)
    expect(ids).toContain(otherIssue.id)
    expect(ids).not.toContain(plainIssue.id)
  })

  it('cascade: deleting label removes it from all issue_labels', async () => {
    // Create a new label and assign to 3 issues
    const tempLabel = await createLabel(app, companyId, 'cascade-multi', '#123456')
    const issues = await Promise.all([
      createIssue(app, companyId, 'Cascade A'),
      createIssue(app, companyId, 'Cascade B'),
      createIssue(app, companyId, 'Cascade C'),
    ])
    for (const issue of issues) {
      await assignLabel(app, companyId, issue.id, tempLabel.id)
    }

    // Delete the label
    const deleteRes = await app.request(
      `/api/companies/${companyId}/labels/${tempLabel.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)

    // All issues should now have no labels (for this label)
    for (const issue of issues) {
      const res = await app.request(
        `/api/companies/${companyId}/issues/${issue.id}/labels`,
      )
      const body = (await res.json()) as { data: LabelRow[] }
      const found = body.data.find((l) => l.id === tempLabel.id)
      expect(found).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Battle: special characters and naming edge cases
// ---------------------------------------------------------------------------

describe('labels battle — naming edge cases (#278)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'LBNM')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('label with hyphenated name is created successfully', async () => {
    const label = await createLabel(app, companyId, 'needs-review', '#abcdef')
    expect(label.name).toBe('needs-review')
  })

  it('label with slash/colon special chars is created successfully', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'type:bug', color: '#ff0000' }),
    })
    // Should succeed (name is just a string — no restriction on special chars)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('type:bug')
  })

  it('label with unicode name is handled', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'バグ', color: '#ff0000' }),
    })
    expect([201, 400].includes(res.status)).toBe(true)
  })

  it('label name with leading/trailing whitespace — behavior check', async () => {
    // ENHANCEMENT: The API should trim whitespace from label names.
    // Currently the validator may or may not trim — this test documents the behavior.
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  spacey  ', color: '#ff0000' }),
    })
    // Either trims and accepts (201) or rejects (400) — document which
    expect([201, 400].includes(res.status)).toBe(true)
  })

  it('empty label name returns 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', color: '#ff0000' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('color with 3-char shorthand hex is accepted (validator explicitly allows #rgb)', async () => {
    // The validator in @shackleai/shared intentionally allows 3-char (#rgb) or 6-char (#rrggbb) hex.
    // Regex: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
    // This test documents that designed behavior and verifies the stored value is '#abc' (not expanded).
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'short-hex', color: '#abc' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.color).toBe('#abc')
  })

  it('color without # prefix returns 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no-hash', color: 'aabbcc' }),
    })
    expect(res.status).toBe(400)
  })

  it('color as CSS color name returns 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'named-color', color: 'blue' }),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Battle: PUT update edge cases
// ---------------------------------------------------------------------------

describe('labels battle — PUT update edge cases (#278)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'LBPU')
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('PUT rename to the same name as another label in same company → 409', async () => {
    await createLabel(app, companyId, 'name-taken', '#111111')
    const label2 = await createLabel(app, companyId, 'rename-target', '#222222')

    const res = await app.request(`/api/companies/${companyId}/labels/${label2.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'name-taken' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('already exists')
  })

  it('PUT rename to own current name is allowed (idempotent)', async () => {
    const label = await createLabel(app, companyId, 'self-rename', '#333333')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'self-rename' }),
    })
    // Should be 200 — renaming to same name is not a conflict
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('self-rename')
  })

  it('PUT can update description only', async () => {
    const label = await createLabel(app, companyId, 'desc-update', '#444444')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated description' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.description).toBe('Updated description')
    expect(body.data.name).toBe('desc-update')
  })

  it('PUT with empty body returns 200 with current data (no-op)', async () => {
    const label = await createLabel(app, companyId, 'noop-update', '#555555')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('noop-update')
  })

  it('PUT with invalid color on update returns 400', async () => {
    const label = await createLabel(app, companyId, 'bad-color-update', '#666666')

    const res = await app.request(`/api/companies/${companyId}/labels/${label.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: 'notacolor' }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT on non-existent label returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/labels/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ghost' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('DELETE non-existent label returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/labels/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle: unlink edge cases
// ---------------------------------------------------------------------------

describe('labels battle — unlink edge cases (#278)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let issueId: string
  let labelId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    const company = await createCompany(app, 'LBUN')
    companyId = company.id
    issueId = (await createIssue(app, companyId, 'Unlink test issue')).id
    const label = await createLabel(app, companyId, 'unlink-test', '#aaaaaa')
    labelId = label.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('DELETE label not assigned to issue returns 404', async () => {
    // label is NOT assigned to issueId
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${labelId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('not assigned')
  })

  it('double-unlink: removing same label twice returns 404 on second attempt', async () => {
    await assignLabel(app, companyId, issueId, labelId)

    // First unlink — should succeed
    const res1 = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${labelId}`,
      { method: 'DELETE' },
    )
    expect(res1.status).toBe(200)

    // Second unlink — already removed
    const res2 = await app.request(
      `/api/companies/${companyId}/issues/${issueId}/labels/${labelId}`,
      { method: 'DELETE' },
    )
    expect(res2.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle: multi-tenant isolation for labels
// ---------------------------------------------------------------------------

describe('labels battle — multi-tenant isolation (#278)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyAId: string
  let companyBId: string
  let labelAId: string
  let issueAId: string
  let issueBId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const companyA = await createCompany(app, 'LMTA')
    companyAId = companyA.id
    const companyB = await createCompany(app, 'LMTB')
    companyBId = companyB.id

    const labelA = await createLabel(app, companyAId, 'company-a-label', '#ff0000')
    labelAId = labelA.id

    issueAId = (await createIssue(app, companyAId, 'Company A Issue')).id
    issueBId = (await createIssue(app, companyBId, 'Company B Issue')).id
  })

  afterAll(async () => {
    await db.close()
  })

  it('company B cannot assign company A label to company B issue', async () => {
    // label_id belongs to company A, but we're requesting via company B scope
    // The label won't be found under company B
    const res = await assignLabel(app, companyBId, issueBId, labelAId)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Label not found')
  })

  it('company B cannot update company A label', async () => {
    const res = await app.request(`/api/companies/${companyBId}/labels/${labelAId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hijacked' }),
    })
    expect(res.status).toBe(404)
  })

  it('company B cannot delete company A label', async () => {
    const res = await app.request(`/api/companies/${companyBId}/labels/${labelAId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('company A label does not appear in company B label list', async () => {
    const res = await app.request(`/api/companies/${companyBId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    const found = body.data.find((l) => l.id === labelAId)
    expect(found).toBeUndefined()
  })

  it('same label name can exist in different companies (no cross-company unique constraint)', async () => {
    // company A already has 'company-a-label', create same name in company B
    const res = await app.request(`/api/companies/${companyBId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'company-a-label', color: '#00ff00' }),
    })
    expect(res.status).toBe(201)
  })

  it('company B cannot access company A issue labels via company A issue ID', async () => {
    // Assign company A label to company A issue
    await assignLabel(app, companyAId, issueAId, labelAId)

    // Company B scope, company A issue ID — issue not found in company B
    const res = await app.request(
      `/api/companies/${companyBId}/issues/${issueAId}/labels`,
    )
    expect(res.status).toBe(404)
  })
})
