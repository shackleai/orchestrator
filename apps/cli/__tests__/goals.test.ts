import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { GoalLevel, GoalStatus } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: ReturnType<typeof createApp>, name = 'Test Corp') {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: name.toUpperCase().slice(0, 4) }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createGoal(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request(`/api/companies/${companyId}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Achieve World Domination',
      ...overrides,
    }),
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('goals routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
    companyId = await createCompany(app)
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/goals returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/goals creates goal', async () => {
    const res = await createGoal(app, companyId, {
      title: 'Ship v1.0',
      level: GoalLevel.Strategic,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        company_id: string
        title: string
        level: string
        status: string
      }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.title).toBe('Ship v1.0')
    expect(body.data.level).toBe(GoalLevel.Strategic)
    expect(body.data.status).toBe(GoalStatus.Active)
  })

  it('POST /api/companies/:id/goals returns 400 on missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: GoalLevel.Task }), // missing title
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/goals returns 400 on empty title', async () => {
    const res = await createGoal(app, companyId, { title: '' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/goals returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/companies/:id/goals returns 404 for non-existent company', async () => {
    const res = await createGoal(app, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/goals lists multiple goals', async () => {
    const newCompanyId = await createCompany(app, 'Multi Goal Corp')
    await createGoal(app, newCompanyId, { title: 'Goal A', level: GoalLevel.Strategic })
    await createGoal(app, newCompanyId, { title: 'Goal B', level: GoalLevel.Initiative })
    await createGoal(app, newCompanyId, { title: 'Goal C', level: GoalLevel.Task })

    const res = await app.request(`/api/companies/${newCompanyId}/goals`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(3)
  })

  it('POST /api/companies/:id/goals supports optional fields', async () => {
    const res = await createGoal(app, companyId, {
      title: 'Goal With Description',
      description: 'A detailed description',
      level: GoalLevel.Project,
      status: GoalStatus.Active,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { description: string | null; level: string }
    }
    expect(body.data.description).toBe('A detailed description')
    expect(body.data.level).toBe(GoalLevel.Project)
  })
})
