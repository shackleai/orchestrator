import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AdapterType } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  assignee_agent_id: string | null
}

async function createCompany(
  app: ReturnType<typeof createApp>,
  prefix: string,
) {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Company ${prefix}`, issue_prefix: prefix }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgentDirectly(
  app: ReturnType<typeof createApp>,
  companyId: string,
  name: string,
) {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      adapter_type: AdapterType.Process,
    }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createTask(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Default Task', ...overrides }),
  })
  const body = (await res.json()) as { data: IssueRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Tests — task CLI command API calls
// ---------------------------------------------------------------------------

describe('task CLI command — API integration', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
    companyId = await createCompany(app, 'TASK')
  })

  afterAll(async () => {
    await db.close()
  })

  it('list tasks returns empty array initially', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('create task via API and list it', async () => {
    const createRes = await app.request(`/api/companies/${companyId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Implement CLI',
        description: 'Build the CLI commands',
        priority: 'high',
      }),
    })
    expect(createRes.status).toBe(201)

    const listRes = await app.request(`/api/companies/${companyId}/issues`)
    const body = (await listRes.json()) as { data: IssueRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe('Implement CLI')
    expect(body.data[0].identifier).toBe('TASK-1')
    expect(body.data[0].priority).toBe('high')
  })

  it('assign task to agent via checkout endpoint', async () => {
    const task = await createTask(app, companyId, { title: 'Assignable Task' })
    const agentId = await createAgentDirectly(app, companyId, 'Worker')

    const res = await app.request(
      `/api/companies/${companyId}/issues/${task.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('in_progress')
    expect(body.data.assignee_agent_id).toBe(agentId)
  })

  it('complete task via PATCH status=done', async () => {
    const task = await createTask(app, companyId, { title: 'Completable Task' })

    const res = await app.request(
      `/api/companies/${companyId}/issues/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: IssueRow }
    expect(body.data.status).toBe('done')
  })

  it('complete returns 404 for non-existent task', async () => {
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

  it('assign returns 409 if task already claimed', async () => {
    const task = await createTask(app, companyId, { title: 'Double Claim' })
    const agent1 = await createAgentDirectly(app, companyId, 'Agent1')
    const agent2 = await createAgentDirectly(app, companyId, 'Agent2')

    // First checkout
    const first = await app.request(
      `/api/companies/${companyId}/issues/${task.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent1 }),
      },
    )
    expect(first.status).toBe(200)

    // Second checkout should 409
    const second = await app.request(
      `/api/companies/${companyId}/issues/${task.id}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent2 }),
      },
    )
    expect(second.status).toBe(409)
  })
})
