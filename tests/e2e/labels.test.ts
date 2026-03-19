/**
 * E2E: Label CRUD + Issue Label Assignment + Label Filtering
 *
 * Tests the full label lifecycle:
 *   company -> label CRUD -> issue-label assignment -> issue list filtering by label
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LabelRow = {
  id: string
  company_id: string
  name: string
  color: string
  description: string | null
}

type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: PGliteProvider
let app: ReturnType<typeof createApp>
let companyId: string

async function createCompany(name = 'Label Corp'): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: 'LBL',
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createIssue(title: string): Promise<IssueRow> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

async function createLabel(
  name: string,
  color = '#ff0000',
  description?: string,
): Promise<LabelRow> {
  const res = await app.request(`/api/companies/${companyId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, description }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: LabelRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  app = createApp(db, { skipAuth: true })
  companyId = await createCompany()
})

afterAll(async () => {
  await db.close()
})

// ---------------------------------------------------------------------------
// Label CRUD
// ---------------------------------------------------------------------------

describe('Label CRUD', () => {
  it('creates a label with defaults', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bug' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('bug')
    expect(body.data.color).toBe('#6b7280') // default color
    expect(body.data.company_id).toBe(companyId)
  })

  it('creates a label with custom color and description', async () => {
    const label = await createLabel('feature', '#00ff00', 'New feature requests')
    expect(label.name).toBe('feature')
    expect(label.color).toBe('#00ff00')
    expect(label.description).toBe('New feature requests')
  })

  it('rejects duplicate label names within a company', async () => {
    await createLabel('duplicate-test', '#aabbcc')
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'duplicate-test', color: '#112233' }),
    })
    expect(res.status).toBe(409)
  })

  it('rejects invalid hex color', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad-color', color: 'red' }),
    })
    expect(res.status).toBe(400)
  })

  it('lists all labels for a company', async () => {
    const res = await app.request(`/api/companies/${companyId}/labels`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)
    // Should be ordered by name
    const names = body.data.map((l) => l.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('updates a label', async () => {
    const label = await createLabel('to-update', '#111111')
    const res = await app.request(
      `/api/companies/${companyId}/labels/${label.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated-label', color: '#222222' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow }
    expect(body.data.name).toBe('updated-label')
    expect(body.data.color).toBe('#222222')
  })

  it('returns 404 when updating non-existent label', async () => {
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

  it('deletes a label', async () => {
    const label = await createLabel('to-delete', '#333333')
    const res = await app.request(
      `/api/companies/${companyId}/labels/${label.id}`,
      {
        method: 'DELETE',
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)

    // Verify gone
    const listRes = await app.request(`/api/companies/${companyId}/labels`)
    const listBody = (await listRes.json()) as { data: LabelRow[] }
    expect(listBody.data.find((l) => l.id === label.id)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Issue-Label Assignment
// ---------------------------------------------------------------------------

describe('Issue-Label Assignment', () => {
  let issue: IssueRow
  let label: LabelRow

  beforeAll(async () => {
    issue = await createIssue('Test issue for labels')
    label = await createLabel('assign-test', '#444444')
  })

  it('assigns a label to an issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: label.id }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { assigned: boolean } }
    expect(body.data.assigned).toBe(true)
  })

  it('rejects duplicate assignment', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: label.id }),
      },
    )
    expect(res.status).toBe(409)
  })

  it('lists labels on an issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(label.id)
  })

  it('removes a label from an issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels/${label.id}`,
      {
        method: 'DELETE',
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { removed: boolean } }
    expect(body.data.removed).toBe(true)

    // Verify removed
    const listRes = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels`,
    )
    const listBody = (await listRes.json()) as { data: LabelRow[] }
    expect(listBody.data.length).toBe(0)
  })

  it('returns 404 for non-existent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/labels`,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent label on assign', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label_id: '00000000-0000-0000-0000-000000000000',
        }),
      },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Issue List Filtering by Label
// ---------------------------------------------------------------------------

describe('Issue Filtering by Label', () => {
  let labelBug: LabelRow
  let labelFeature: LabelRow
  let issueBug: IssueRow
  let issueFeature: IssueRow

  beforeAll(async () => {
    labelBug = await createLabel('filter-bug', '#ff0000')
    labelFeature = await createLabel('filter-feature', '#00ff00')

    issueBug = await createIssue('Bug issue')
    issueFeature = await createIssue('Feature issue')
    await createIssue('Unlabeled issue')

    // Assign labels
    await app.request(
      `/api/companies/${companyId}/issues/${issueBug.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: labelBug.id }),
      },
    )
    await app.request(
      `/api/companies/${companyId}/issues/${issueFeature.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: labelFeature.id }),
      },
    )
  })

  it('filters issues by label name', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues?label=filter-bug`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(issueBug.id)
  })

  it('returns empty for non-existent label filter', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues?label=nonexistent`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    expect(body.data.length).toBe(0)
  })

  it('returns all issues without label filter', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow[] }
    // Should include at least our 3 created issues plus any from other tests
    expect(body.data.length).toBeGreaterThanOrEqual(3)
  })

  it('cascades label deletion to issue_labels junction', async () => {
    // Create a label, assign it, then delete the label
    const tempLabel = await createLabel('cascade-test', '#999999')
    const tempIssue = await createIssue('Cascade test issue')

    await app.request(
      `/api/companies/${companyId}/issues/${tempIssue.id}/labels`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: tempLabel.id }),
      },
    )

    // Delete the label
    await app.request(
      `/api/companies/${companyId}/labels/${tempLabel.id}`,
      {
        method: 'DELETE',
      },
    )

    // Issue should have no labels now
    const res = await app.request(
      `/api/companies/${companyId}/issues/${tempIssue.id}/labels`,
    )
    const body = (await res.json()) as { data: LabelRow[] }
    expect(body.data.length).toBe(0)
  })
})
