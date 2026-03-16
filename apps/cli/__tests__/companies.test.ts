import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

describe('companies routes — CRUD', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db)
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /api/companies returns empty array on fresh DB', async () => {
    const res = await app.request('/api/companies')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('POST /api/companies creates a company', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Acme Corp',
        issue_prefix: 'ACME',
        budget_monthly_cents: 10000,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { id: string; name: string; issue_prefix: string } }
    expect(body.data.name).toBe('Acme Corp')
    expect(body.data.issue_prefix).toBe('ACME')
    expect(body.data.id).toBeTruthy()
  })

  it('POST /api/companies returns 400 on missing required fields', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Prefix' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies returns 400 on empty name', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', issue_prefix: 'BAD' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('POST /api/companies returns 400 on invalid JSON', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/companies/:id returns company', async () => {
    // Create one first
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta Ltd', issue_prefix: 'BETA' }),
    })
    const created = (await createRes.json()) as { data: { id: string } }
    const id = created.data.id

    const res = await app.request(`/api/companies/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; name: string } }
    expect(body.data.id).toBe(id)
    expect(body.data.name).toBe('Beta Ltd')
  })

  it('GET /api/companies/:id returns 404 for non-existent company', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Company not found')
  })

  it('PATCH /api/companies/:id updates company fields', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gamma Inc', issue_prefix: 'GAM' }),
    })
    const created = (await createRes.json()) as { data: { id: string } }
    const id = created.data.id

    const res = await app.request(`/api/companies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gamma Inc Updated' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string } }
    expect(body.data.name).toBe('Gamma Inc Updated')
  })

  it('PATCH /api/companies/:id returns 404 for non-existent company', async () => {
    const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/companies/:id returns 400 on validation error', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delta Co', issue_prefix: 'DEL' }),
    })
    const created = (await createRes.json()) as { data: { id: string } }
    const id = created.data.id

    const res = await app.request(`/api/companies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/companies lists multiple companies', async () => {
    const res = await app.request('/api/companies')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThan(0)
  })
})
