import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { ProjectStatus } from '@shackleai/shared'

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

async function createProject(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request(`/api/companies/${companyId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Default Project',
      ...overrides,
    }),
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('projects routes — CRUD', () => {
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

  it('GET /api/companies/:id/projects returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/projects`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/projects creates project', async () => {
    const res = await createProject(app, companyId, {
      name: 'Platform v2',
      description: 'Rebuild the platform',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        company_id: string
        name: string
        description: string | null
        status: string
      }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.company_id).toBe(companyId)
    expect(body.data.name).toBe('Platform v2')
    expect(body.data.description).toBe('Rebuild the platform')
    expect(body.data.status).toBe(ProjectStatus.Active)
  })

  it('POST /api/companies/:id/projects returns 400 on missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No name' }), // missing name
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/projects returns 400 on empty name', async () => {
    const res = await createProject(app, companyId, { name: '' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/projects returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/companies/:id/projects returns 404 for non-existent company', async () => {
    const res = await createProject(app, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/projects lists multiple projects', async () => {
    const newCompanyId = await createCompany(app, 'Multi Project Corp')
    await createProject(app, newCompanyId, { name: 'Project Alpha' })
    await createProject(app, newCompanyId, { name: 'Project Beta' })

    const res = await app.request(`/api/companies/${newCompanyId}/projects`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('POST /api/companies/:id/projects supports optional fields', async () => {
    const res = await createProject(app, companyId, {
      name: 'Dated Project',
      target_date: '2026-12-31',
      status: ProjectStatus.Active,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { target_date: string | null; status: string }
    }
    expect(body.data.target_date).toContain('2026-12-31')
    expect(body.data.status).toBe(ProjectStatus.Active)
  })
})
