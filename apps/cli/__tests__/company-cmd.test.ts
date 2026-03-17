import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: ReturnType<typeof createApp>,
  name: string,
  prefix: string,
) {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: prefix }),
  })
  const body = (await res.json()) as { data: { id: string; name: string } }
  return body.data
}

// ---------------------------------------------------------------------------
// Tests — company CLI command API calls
// ---------------------------------------------------------------------------

describe('company CLI command — API integration', () => {
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

  it('list companies returns empty array initially', async () => {
    const res = await app.request('/api/companies')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('list companies returns created companies', async () => {
    await createCompany(app, 'Alpha Corp', 'ALPH')
    await createCompany(app, 'Beta LLC', 'BETA')

    const res = await app.request('/api/companies')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { name: string }[] }
    expect(body.data.length).toBeGreaterThanOrEqual(2)

    const names = body.data.map((c) => c.name)
    expect(names).toContain('Alpha Corp')
    expect(names).toContain('Beta LLC')
  })

  it('switch company — find by exact ID', async () => {
    const company = await createCompany(app, 'Switch Corp', 'SWTC')

    // Verify the company exists by fetching it by ID
    const res = await app.request(`/api/companies/${company.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { id: string; name: string } }
    expect(body.data.id).toBe(company.id)
    expect(body.data.name).toBe('Switch Corp')
  })

  it('switch company — find by ID prefix via list + filter', async () => {
    const company = await createCompany(app, 'Prefix Corp', 'PRFX')
    const prefix = company.id.slice(0, 8)

    // List all and filter by prefix (simulates CLI switch logic)
    const res = await app.request('/api/companies')
    const body = (await res.json()) as { data: { id: string; name: string }[] }
    const match = body.data.find((c) => c.id.startsWith(prefix))

    expect(match).toBeDefined()
    expect(match!.name).toBe('Prefix Corp')
  })

  it('switch company — find by name via list + filter', async () => {
    await createCompany(app, 'NameMatch Inc', 'NAMI')

    const res = await app.request('/api/companies')
    const body = (await res.json()) as { data: { id: string; name: string }[] }
    const match = body.data.find(
      (c) => c.name.toLowerCase() === 'namematch inc',
    )

    expect(match).toBeDefined()
    expect(match!.name).toBe('NameMatch Inc')
  })

  it('create company returns the new company with all fields', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Full Fields Co',
        description: 'A company with all fields',
        issue_prefix: 'FFC',
        budget_monthly_cents: 50000,
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        id: string
        name: string
        description: string
        issue_prefix: string
        budget_monthly_cents: number
      }
    }
    expect(body.data.name).toBe('Full Fields Co')
    expect(body.data.description).toBe('A company with all fields')
    expect(body.data.issue_prefix).toBe('FFC')
    expect(body.data.budget_monthly_cents).toBe(50000)
  })

  it('current company — GET by ID returns company details', async () => {
    const company = await createCompany(app, 'Current Corp', 'CURR')

    const res = await app.request(`/api/companies/${company.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        id: string
        name: string
        status: string
        issue_prefix: string
      }
    }
    expect(body.data.id).toBe(company.id)
    expect(body.data.name).toBe('Current Corp')
    expect(body.data.status).toBe('active')
    expect(body.data.issue_prefix).toBe('CURR')
  })
})
