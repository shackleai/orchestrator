import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { IssueStatus } from '@shackleai/shared'
import { createApp } from '../src/server/index.js'

describe('dashboard routes — metrics aggregation', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)

    // Create a test company
    const res = await db.query<{ id: string }>(
      `INSERT INTO companies (name, issue_prefix) VALUES ($1, $2) RETURNING id`,
      ['Dashboard Test Co', 'DASH'],
    )
    companyId = res.rows[0].id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/dashboard returns zeroed metrics on empty data', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: {
        agentCount: number
        taskCount: number
        openTasks: number
        completedTasks: number
        totalSpendCents: number
        recentActivity: unknown[]
      }
    }

    expect(body.data.agentCount).toBe(0)
    expect(body.data.taskCount).toBe(0)
    expect(body.data.openTasks).toBe(0)
    expect(body.data.completedTasks).toBe(0)
    expect(body.data.totalSpendCents).toBe(0)
    expect(Array.isArray(body.data.recentActivity)).toBe(true)
    expect(body.data.recentActivity).toHaveLength(0)
  })

  it('GET /api/companies/:id/dashboard returns correct counts after seeding data', async () => {
    // Insert agents
    const agent1 = await db.query<{ id: string }>(
      `INSERT INTO agents (company_id, name, role, adapter_type) VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyId, 'agent-one', 'worker', 'process'],
    )
    const agent2 = await db.query<{ id: string }>(
      `INSERT INTO agents (company_id, name, role, adapter_type) VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyId, 'agent-two', 'manager', 'process'],
    )
    const agentId = agent1.rows[0].id

    // Insert issues: 1 done, 2 in_progress, 1 backlog
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, 'DASH-1', 1, 'Done task', IssueStatus.Done],
    )
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, 'DASH-2', 2, 'In progress task', IssueStatus.InProgress],
    )
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, 'DASH-3', 3, 'In progress task 2', IssueStatus.InProgress],
    )
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, 'DASH-4', 4, 'Backlog task', IssueStatus.Backlog],
    )

    // Insert cost events
    await db.query(
      `INSERT INTO cost_events (company_id, agent_id, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, agentId, 100, 50, 250],
    )
    await db.query(
      `INSERT INTO cost_events (company_id, agent_id, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, agentId, 200, 100, 500],
    )

    // Insert activity log entries
    for (let i = 1; i <= 7; i++) {
      await db.query(
        `INSERT INTO activity_log (company_id, entity_type, actor_type, action)
         VALUES ($1, $2, $3, $4)`,
        [companyId, 'issue', 'agent', `action-${i}`],
      )
    }

    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: {
        agentCount: number
        taskCount: number
        openTasks: number
        completedTasks: number
        totalSpendCents: number
        recentActivity: unknown[]
      }
    }

    expect(body.data.agentCount).toBe(2)
    expect(body.data.taskCount).toBe(4)
    // openTasks = not done and not cancelled: in_progress(2) + backlog(1) = 3
    expect(body.data.openTasks).toBe(3)
    expect(body.data.completedTasks).toBe(1)
    expect(body.data.totalSpendCents).toBe(750)
    // recentActivity capped at 5
    expect(body.data.recentActivity).toHaveLength(5)
  })

  it('GET /api/companies/:id/dashboard returns 404 for non-existent company', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000/dashboard')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Company not found')
  })
})
