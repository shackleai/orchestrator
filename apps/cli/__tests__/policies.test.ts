import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { PolicyAction } from '@shackleai/shared'

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

async function createPolicy(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request(`/api/companies/${companyId}/policies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Default Policy',
      tool_pattern: 'github.*',
      ...overrides,
    }),
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('policies routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app)
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies/:id/policies returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies/:id/policies creates policy', async () => {
    const res = await createPolicy(app, companyId)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { id: string; name: string; tool_pattern: string; action: string; priority: number }
    }
    expect(body.data.id).toBeTruthy()
    expect(body.data.name).toBe('Default Policy')
    expect(body.data.tool_pattern).toBe('github.*')
    expect(body.data.action).toBe(PolicyAction.Allow)
    expect(body.data.priority).toBe(0)
  })

  it('POST /api/companies/:id/policies returns 400 on missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete' }), // missing tool_pattern
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies/:id/policies returns 400 on invalid JSON', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/companies/:id/policies returns 404 for non-existent company', async () => {
    const res = await createPolicy(app, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('PATCH /api/companies/:id/policies/:policyId updates policy fields', async () => {
    const createRes = await createPolicy(app, companyId, { name: 'Patchable Policy' })
    const created = (await createRes.json()) as { data: { id: string } }
    const policyId = created.data.id

    const res = await app.request(`/api/companies/${companyId}/policies/${policyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Policy', action: PolicyAction.Deny }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string; action: string } }
    expect(body.data.name).toBe('Updated Policy')
    expect(body.data.action).toBe(PolicyAction.Deny)
  })

  it('PATCH /api/companies/:id/policies/:policyId returns 404 for non-existent policy', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('DELETE /api/companies/:id/policies/:policyId deletes policy', async () => {
    const createRes = await createPolicy(app, companyId, { name: 'To Delete' })
    const created = (await createRes.json()) as { data: { id: string } }
    const policyId = created.data.id

    const deleteRes = await app.request(`/api/companies/${companyId}/policies/${policyId}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    const body = (await deleteRes.json()) as { data: { deleted: boolean; id: string } }
    expect(body.data.deleted).toBe(true)
    expect(body.data.id).toBe(policyId)

    // Confirm it is gone
    const getRes = await app.request(`/api/companies/${companyId}/policies`)
    const getBody = (await getRes.json()) as { data: { id: string }[] }
    expect(getBody.data.find((p) => p.id === policyId)).toBeUndefined()
  })

  it('DELETE /api/companies/:id/policies/:policyId returns 404 for non-existent policy', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/policies lists multiple policies', async () => {
    const newCompanyId = await createCompany(app, 'Multi Policy Corp')
    await createPolicy(app, newCompanyId, { name: 'Policy A' })
    await createPolicy(app, newCompanyId, { name: 'Policy B' })

    const res = await app.request(`/api/companies/${newCompanyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })
})
