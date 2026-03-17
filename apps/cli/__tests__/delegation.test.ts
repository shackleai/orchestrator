import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; issue_prefix: string; issue_counter: number }
type IssueRow = {
  id: string
  identifier: string
  issue_number: number
  title: string
  description: string | null
  status: string
  priority: string
  assignee_agent_id: string | null
  parent_id: string | null
  company_id: string
}
type AgentRow = { id: string; name: string }
type DelegateResponse = { data: { delegated: boolean; child_issue_ids: string[] } }

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
  name: string,
  reportsTo?: string,
): Promise<AgentRow> {
  const result = await db.query<AgentRow>(
    `INSERT INTO agents (company_id, name, adapter_type, adapter_config, reports_to)
     VALUES ($1, $2, 'process', '{}', $3)
     RETURNING id, name`,
    [companyId, name, reportsTo ?? null],
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
// Tests — Delegation
// ---------------------------------------------------------------------------

describe('delegation — hierarchy validation', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let ceoId: string
  let managerId: string
  let workerId: string
  let unrelatedId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
    const company = await createCompany(app, 'DEL')
    companyId = company.id

    // Build hierarchy: CEO -> Manager -> Worker
    const ceo = await createAgent(db, companyId, 'CEO Agent')
    ceoId = ceo.id
    const manager = await createAgent(db, companyId, 'Manager Agent', ceoId)
    managerId = manager.id
    const worker = await createAgent(db, companyId, 'Worker Agent', managerId)
    workerId = worker.id
    const unrelated = await createAgent(db, companyId, 'Unrelated Agent')
    unrelatedId = unrelated.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('CEO can delegate to Manager (direct report)', async () => {
    const issue = await createIssue(app, companyId, { title: 'Strategic Task' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [
            { title: 'Research competitors', description: 'Full market analysis' },
            { title: 'Draft report' },
          ],
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as DelegateResponse
    expect(body.data.delegated).toBe(true)
    expect(body.data.child_issue_ids).toHaveLength(2)
  })

  it('child issues have correct parent_id and assignee', async () => {
    const issue = await createIssue(app, companyId, { title: 'Parent Task' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Sub task A' }],
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as DelegateResponse
    const childId = body.data.child_issue_ids[0]

    // Verify child issue details
    const childRes = await app.request(`/api/companies/${companyId}/issues/${childId}`)
    expect(childRes.status).toBe(200)
    const childBody = (await childRes.json()) as { data: IssueRow }
    expect(childBody.data.parent_id).toBe(issue.id)
    expect(childBody.data.assignee_agent_id).toBe(managerId)
    expect(childBody.data.status).toBe('todo')
  })

  it('child issues get auto-generated identifiers', async () => {
    const issue = await createIssue(app, companyId, { title: 'Identifier Parent' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Child 1' }, { title: 'Child 2' }],
        }),
      },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as DelegateResponse

    // Verify both children have DEL-prefixed identifiers
    for (const childId of body.data.child_issue_ids) {
      const childRes = await app.request(`/api/companies/${companyId}/issues/${childId}`)
      const childBody = (await childRes.json()) as { data: IssueRow }
      expect(childBody.data.identifier).toMatch(/^DEL-\d+$/)
    }
  })

  it('Manager cannot delegate to CEO (wrong direction)', async () => {
    const issue = await createIssue(app, companyId, { title: 'Reverse Delegation' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: managerId,
          to_agent_id: ceoId,
          sub_tasks: [{ title: 'Invalid task' }],
        }),
      },
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('does not report to')
  })

  it('unrelated agent cannot delegate to another', async () => {
    const issue = await createIssue(app, companyId, { title: 'Unrelated Delegation' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: unrelatedId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Nope' }],
        }),
      },
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 on empty sub_tasks array', async () => {
    const issue = await createIssue(app, companyId, { title: 'No Tasks' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [],
        }),
      },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid JSON body', async () => {
    const issue = await createIssue(app, companyId, { title: 'Bad JSON' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    )
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-existent parent issue', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/00000000-0000-0000-0000-000000000000/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Ghost' }],
        }),
      },
    )
    // canDelegate will fail since the agents exist but the issue doesn't
    // Actually canDelegate only checks agents, so it will pass, then delegate checks issue
    expect(res.status).toBe(403)
  })

  it('Manager delegates to Worker (chained delegation)', async () => {
    const issue = await createIssue(app, companyId, { title: 'Manager Task' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${issue.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: managerId,
          to_agent_id: workerId,
          sub_tasks: [{ title: 'Worker sub-task' }],
        }),
      },
    )
    expect(res.status).toBe(201)
  })
})

describe('delegation — status roll-up', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let ceoId: string
  let managerId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
    const company = await createCompany(app, 'ROLL')
    companyId = company.id

    const ceo = await createAgent(db, companyId, 'CEO')
    ceoId = ceo.id
    const manager = await createAgent(db, companyId, 'Manager', ceoId)
    managerId = manager.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('parent auto-completes when all children are done', async () => {
    const parent = await createIssue(app, companyId, { title: 'Roll-up Parent' })

    // Delegate two sub-tasks
    const delRes = await app.request(
      `/api/companies/${companyId}/issues/${parent.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Sub A' }, { title: 'Sub B' }],
        }),
      },
    )
    const delBody = (await delRes.json()) as DelegateResponse
    const [childA, childB] = delBody.data.child_issue_ids

    // Complete child A
    await app.request(`/api/companies/${companyId}/issues/${childA}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })

    // Parent should NOT be done yet (only 1/2 children done)
    const parentCheck1 = await app.request(`/api/companies/${companyId}/issues/${parent.id}`)
    const parentBody1 = (await parentCheck1.json()) as { data: IssueRow }
    expect(parentBody1.data.status).not.toBe('done')

    // Complete child B
    await app.request(`/api/companies/${companyId}/issues/${childB}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })

    // Give the async roll-up a moment to complete
    await new Promise((r) => setTimeout(r, 100))

    // Parent should now be done
    const parentCheck2 = await app.request(`/api/companies/${companyId}/issues/${parent.id}`)
    const parentBody2 = (await parentCheck2.json()) as { data: IssueRow }
    expect(parentBody2.data.status).toBe('done')
  })

  it('parent stays incomplete when only some children are done', async () => {
    const parent = await createIssue(app, companyId, { title: 'Partial Parent' })

    const delRes = await app.request(
      `/api/companies/${companyId}/issues/${parent.id}/delegate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: ceoId,
          to_agent_id: managerId,
          sub_tasks: [{ title: 'Sub X' }, { title: 'Sub Y' }],
        }),
      },
    )
    const delBody = (await delRes.json()) as DelegateResponse
    const [childX] = delBody.data.child_issue_ids

    // Complete only one child
    await app.request(`/api/companies/${companyId}/issues/${childX}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })

    await new Promise((r) => setTimeout(r, 100))

    // Parent should still be backlog (not auto-completed)
    const parentRes = await app.request(`/api/companies/${companyId}/issues/${parent.id}`)
    const parentBody = (await parentRes.json()) as { data: IssueRow }
    expect(parentBody.data.status).not.toBe('done')
  })
})
