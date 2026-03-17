/**
 * E2E: Goal and Project CRUD
 *
 * Tests the full goal/project hierarchy:
 *   company → goal → project → issue (linked) → ancestry
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoalRow = {
  id: string
  title: string
  level: string
  status: string
  company_id: string
  parent_id: string | null
  description: string | null
  owner_agent_id: string | null
}
type ProjectRow = {
  id: string
  name: string
  status: string
  goal_id: string | null
  company_id: string
  description: string | null
}
type IssueRow = {
  id: string
  identifier: string
  title: string
  status: string
  goal_id: string | null
  project_id: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: PGliteProvider
let app: ReturnType<typeof createApp>
let companyId: string

async function createCompany(name = 'Test Corp'): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: name.toUpperCase().slice(0, 4),
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  app = createApp(db)
  companyId = await createCompany()
})

afterAll(async () => {
  await db.close()
})

// ---------------------------------------------------------------------------
// Goal CRUD
// ---------------------------------------------------------------------------

describe('Goal CRUD', () => {
  let goalId: string

  it('POST /goals — create goal → 201', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Increase revenue',
        description: 'Grow MRR by 20%',
        level: 'strategic',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: GoalRow }
    expect(body.data.title).toBe('Increase revenue')
    expect(body.data.level).toBe('strategic')
    expect(body.data.status).toBe('active')
    goalId = body.data.id
  })

  it('GET /goals — list goals', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: GoalRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /goals/:goalId — get goal detail', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals/${goalId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: GoalRow & { issues_count: number; projects_count: number }
    }
    expect(body.data.title).toBe('Increase revenue')
    expect(body.data.issues_count).toBe(0)
    expect(body.data.projects_count).toBe(0)
  })

  it('GET /goals/:goalId — 404 for missing goal', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request(
      `/api/companies/${companyId}/goals/${fakeId}`,
    )
    expect(res.status).toBe(404)
  })

  it('PATCH /goals/:goalId — update goal', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals/${goalId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Increase revenue 30%' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: GoalRow }
    expect(body.data.title).toBe('Increase revenue 30%')
  })

  it('PATCH /goals/:goalId — 404 for missing goal', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request(
      `/api/companies/${companyId}/goals/${fakeId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'nope' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('POST /goals — create child goal', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Launch product',
        level: 'initiative',
        parent_id: goalId,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: GoalRow }
    expect(body.data.parent_id).toBe(goalId)
  })

  it('DELETE /goals/:goalId — 409 when goal has child goals', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals/${goalId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('child goals')
  })

  it('POST /goals — validation rejects empty title', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

describe('Project CRUD', () => {
  let projectId: string
  let linkedGoalId: string

  it('POST /goals — create goal for project linking', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Platform launch', level: 'project' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: GoalRow }
    linkedGoalId = body.data.id
  })

  it('POST /projects — create project linked to goal → 201', async () => {
    const res = await app.request(`/api/companies/${companyId}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Q1 Sprint',
        description: 'First sprint of Q1',
        goal_id: linkedGoalId,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: ProjectRow }
    expect(body.data.name).toBe('Q1 Sprint')
    expect(body.data.goal_id).toBe(linkedGoalId)
    expect(body.data.status).toBe('active')
    projectId = body.data.id
  })

  it('GET /projects — list projects', async () => {
    const res = await app.request(`/api/companies/${companyId}/projects`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ProjectRow[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /projects?goal_id= — filter by goal', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/projects?goal_id=${linkedGoalId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ProjectRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].goal_id).toBe(linkedGoalId)
  })

  it('GET /projects/:projectId — get project detail', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/projects/${projectId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: ProjectRow & {
        goal_title: string | null
        issues_count: number
      }
    }
    expect(body.data.name).toBe('Q1 Sprint')
    expect(body.data.goal_title).toBe('Platform launch')
    expect(body.data.issues_count).toBe(0)
  })

  it('PATCH /projects/:projectId — update project', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/projects/${projectId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Q1 Sprint (Updated)' }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: ProjectRow }
    expect(body.data.name).toBe('Q1 Sprint (Updated)')
  })

  it('DELETE /projects/:projectId — succeeds when no linked issues', async () => {
    // Create a standalone project with no issues
    const createRes = await app.request(
      `/api/companies/${companyId}/projects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Temp Project' }),
      },
    )
    const created = (await createRes.json()) as { data: ProjectRow }
    const tempId = created.data.id

    const res = await app.request(
      `/api/companies/${companyId}/projects/${tempId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean } }
    expect(body.data.deleted).toBe(true)
  })

  it('DELETE /projects/:projectId — 404 for missing project', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request(
      `/api/companies/${companyId}/projects/${fakeId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Issue → Goal/Project linking + ancestry
// ---------------------------------------------------------------------------

describe('Issue linking and ancestry', () => {
  let goalId: string
  let projectId: string
  let issueId: string

  it('create goal + project + linked issue', async () => {
    // Create goal
    const goalRes = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Ancestry Goal', level: 'strategic' }),
    })
    const goalBody = (await goalRes.json()) as { data: GoalRow }
    goalId = goalBody.data.id

    // Create project linked to goal
    const projRes = await app.request(
      `/api/companies/${companyId}/projects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ancestry Project',
          goal_id: goalId,
        }),
      },
    )
    const projBody = (await projRes.json()) as { data: ProjectRow }
    projectId = projBody.data.id

    // Create issue linked to goal + project
    const issueRes = await app.request(
      `/api/companies/${companyId}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Implement feature',
          goal_id: goalId,
          project_id: projectId,
        }),
      },
    )
    expect(issueRes.status).toBe(201)
    const issueBody = (await issueRes.json()) as { data: IssueRow }
    issueId = issueBody.data.id
    expect(issueBody.data.goal_id).toBe(goalId)
    expect(issueBody.data.project_id).toBe(projectId)
  })

  it('GET /issues/:id — ancestry resolves goal + project', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/issues/${issueId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: IssueRow & {
        ancestry: {
          mission: string | null
          project: { name: string } | null
          goal: { name: string } | null
          task: { title: string }
        }
      }
    }
    expect(body.data.ancestry.goal?.name).toBe('Ancestry Goal')
    expect(body.data.ancestry.project?.name).toBe('Ancestry Project')
    expect(body.data.ancestry.task.title).toBe('Implement feature')
  })

  it('GET /goals/:goalId — shows correct linked counts', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals/${goalId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: GoalRow & { issues_count: number; projects_count: number }
    }
    expect(body.data.issues_count).toBe(1)
    expect(body.data.projects_count).toBe(1)
  })

  it('DELETE /goals/:goalId — 409 when goal has linked issues', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals/${goalId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('linked issues')
  })

  it('DELETE /projects/:projectId — 409 when project has linked issues', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/projects/${projectId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('linked issues')
  })

  it('GET /goals?project_id= — filter goals by project', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/goals?project_id=${projectId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: GoalRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(goalId)
  })
})
