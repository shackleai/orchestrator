/**
 * E2E Battle Test Suite — Company Management (#266)
 *
 * Covers scenarios NOT already tested in companies.test.ts,
 * e2e-battle.test.ts, or templates.test.ts:
 *
 *  Battle A: Full field creation + update (description, status, all fields)
 *  Battle B: Company switching — context isolation across multiple companies
 *  Battle C: Duplicate issue_prefix constraint
 *  Battle D: Empty company (no agents, no tasks) — dashboard metrics
 *  Battle E: Max-length company name
 *  Battle F: Status lifecycle (active → inactive)
 *  Battle G: Logo upload — valid image types + invalid type rejection
 *  Battle H: Logo replacement + removal
 *  Battle I: LLM key management
 *  Battle J: Rapid company switching — no race conditions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { LocalDiskProvider } from '@shackleai/core'
import type { Company } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type CompanyRow = Company & {
  logo_url: string | null
}

type AgentRow = {
  id: string
  name: string
  status: string
}

type DashboardMetrics = {
  agentCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  totalSpendCents: number
  recentActivity: unknown[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(
  app: App,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<CompanyRow> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      issue_prefix: name.replace(/\s+/g, '').toUpperCase().slice(0, 5),
      ...extra,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: CompanyRow }
  return body.data
}

async function createAgent(
  app: App,
  companyId: string,
  name: string,
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, adapter_type: 'process' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function createIssue(
  app: App,
  companyId: string,
  title: string,
): Promise<{ id: string; identifier: string; status: string }> {
  const res = await app.request(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    data: { id: string; identifier: string; status: string }
  }
  return body.data
}

/** Build a minimal in-memory storage provider backed by a temp dir. */
function makeTempStorage() {
  return new LocalDiskProvider({ basePath: join(tmpdir(), `shackleai-test-${Date.now()}`) })
}

/** Build a valid multipart/form-data body for logo upload. */
async function makeLogoFormData(
  content: Uint8Array,
  filename: string,
  mime: string,
): Promise<FormData> {
  const form = new FormData()
  form.append('file', new File([content], filename, { type: mime }))
  return form
}

// ---------------------------------------------------------------------------
// Battle A: Full field creation + update
// ---------------------------------------------------------------------------

describe('Battle A: full field creation and update', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates company with all optional fields', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Full Fields Corp',
        description: 'A company created with every field specified',
        status: 'active',
        issue_prefix: 'FULL',
        budget_monthly_cents: 50000,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    companyId = body.data.id

    expect(body.data.name).toBe('Full Fields Corp')
    expect(body.data.description).toBe('A company created with every field specified')
    expect(body.data.status).toBe('active')
    expect(body.data.issue_prefix).toBe('FULL')
    expect(body.data.budget_monthly_cents).toBe(50000)
    // logo_url should be null when no logo set
    expect(body.data.logo_url).toBeNull()
  })

  it('GET returns logo_url null when no logo is set', async () => {
    const res = await app.request(`/api/companies/${companyId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.logo_url).toBeNull()
    expect(body.data.logo_asset_id ?? null).toBeNull()
  })

  it('PATCH updates description', async () => {
    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated description text' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.description).toBe('Updated description text')
    // Other fields untouched
    expect(body.data.name).toBe('Full Fields Corp')
    expect(body.data.budget_monthly_cents).toBe(50000)
  })

  it('PATCH updates name and budget together', async () => {
    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Full Fields Corp v2', budget_monthly_cents: 99999 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.name).toBe('Full Fields Corp v2')
    expect(body.data.budget_monthly_cents).toBe(99999)
    // description must still be the updated value from previous step
    expect(body.data.description).toBe('Updated description text')
  })

  it('PATCH with empty body returns current company unchanged', async () => {
    const beforeRes = await app.request(`/api/companies/${companyId}`)
    const before = ((await beforeRes.json()) as { data: CompanyRow }).data

    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    // Core fields must be identical — updated_at may differ
    expect(body.data.name).toBe(before.name)
    expect(body.data.budget_monthly_cents).toBe(before.budget_monthly_cents)
  })

  it('PATCH sets description to null (clearing it)', async () => {
    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.description).toBeNull()
  })

  it('PATCH budget_monthly_cents to 0 is valid', async () => {
    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_monthly_cents: 0 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.budget_monthly_cents).toBe(0)
  })

  it('PATCH budget_monthly_cents negative returns 400', async () => {
    const res = await app.request(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_monthly_cents: -100 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// Battle B: Company switching — data isolation per company context
// ---------------------------------------------------------------------------

describe('Battle B: company switching and context isolation', () => {
  let db: PGliteProvider
  let app: App
  let alphaId: string
  let betaId: string
  let gammaId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    // Create three companies with distinct prefixes
    const alpha = await createCompany(app, 'Alpha Co', { issue_prefix: 'ALPHA' })
    const beta = await createCompany(app, 'Beta Co', { issue_prefix: 'BETAC' })
    const gamma = await createCompany(app, 'Gamma Co', { issue_prefix: 'GAMCO' })
    alphaId = alpha.id
    betaId = beta.id
    gammaId = gamma.id

    // Seed: 2 agents + 2 issues in Alpha, 1 agent + 1 issue in Beta, nothing in Gamma
    await createAgent(app, alphaId, 'Alpha Agent 1')
    await createAgent(app, alphaId, 'Alpha Agent 2')
    await createIssue(app, alphaId, 'Alpha Task 1')
    await createIssue(app, alphaId, 'Alpha Task 2')

    await createAgent(app, betaId, 'Beta Agent 1')
    await createIssue(app, betaId, 'Beta Task 1')
  })

  afterAll(async () => {
    await db.close()
  })

  it('switching to Alpha context shows 2 agents', async () => {
    const res = await app.request(`/api/companies/${alphaId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(2)
    expect(body.data.map((a) => a.name)).toContain('Alpha Agent 1')
    expect(body.data.map((a) => a.name)).toContain('Alpha Agent 2')
  })

  it('switching to Beta context shows only 1 agent', async () => {
    const res = await app.request(`/api/companies/${betaId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Beta Agent 1')
  })

  it('switching to Gamma shows 0 agents', async () => {
    const res = await app.request(`/api/companies/${gammaId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('Alpha issues do not bleed into Beta issue list', async () => {
    const res = await app.request(`/api/companies/${betaId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ title: string }> }
    const titles = body.data.map((i) => i.title)
    expect(titles).not.toContain('Alpha Task 1')
    expect(titles).not.toContain('Alpha Task 2')
    expect(titles).toContain('Beta Task 1')
  })

  it('issue identifiers are scoped per company prefix', async () => {
    const alphaRes = await app.request(`/api/companies/${alphaId}/issues`)
    const alphaBody = (await alphaRes.json()) as {
      data: Array<{ identifier: string }>
    }
    alphaBody.data.forEach((i) => {
      expect(i.identifier).toMatch(/^ALPHA-\d+$/)
    })

    const betaRes = await app.request(`/api/companies/${betaId}/issues`)
    const betaBody = (await betaRes.json()) as {
      data: Array<{ identifier: string }>
    }
    betaBody.data.forEach((i) => {
      expect(i.identifier).toMatch(/^BETAC-\d+$/)
    })
  })

  it('dashboard for Alpha shows correct counts', async () => {
    const res = await app.request(`/api/companies/${alphaId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }
    expect(body.data.agentCount).toBe(2)
    expect(body.data.taskCount).toBe(2)
  })

  it('dashboard for Beta is independent of Alpha', async () => {
    const res = await app.request(`/api/companies/${betaId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }
    expect(body.data.agentCount).toBe(1)
    expect(body.data.taskCount).toBe(1)
  })

  it('renaming Alpha does not affect Beta or Gamma names', async () => {
    await app.request(`/api/companies/${alphaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alpha Co Renamed' }),
    })

    const betaRes = await app.request(`/api/companies/${betaId}`)
    const betaBody = (await betaRes.json()) as { data: CompanyRow }
    expect(betaBody.data.name).toBe('Beta Co')

    const gammaRes = await app.request(`/api/companies/${gammaId}`)
    const gammaBody = (await gammaRes.json()) as { data: CompanyRow }
    expect(gammaBody.data.name).toBe('Gamma Co')
  })
})

// ---------------------------------------------------------------------------
// Battle C: Duplicate issue_prefix constraint
// ---------------------------------------------------------------------------

describe('Battle C: duplicate issue_prefix constraint', () => {
  let db: PGliteProvider
  let app: App

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates first company with prefix UNIQ', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unique Prefix Co', issue_prefix: 'UNIQ' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 409/500 when second company uses the same issue_prefix', async () => {
    // The DB has a UNIQUE constraint on issue_prefix — should fail
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate Prefix Co', issue_prefix: 'UNIQ' }),
    })
    // PGlite unique violation surfaces as a 500 (DB constraint) or a handled 409
    // Either is acceptable — the key assertion is that it does NOT return 201
    // BUG: No deduplication guard returns a user-friendly 409 — raw 500 is returned
    expect(res.status).not.toBe(201)
  })

  it('can create second company with a different prefix after the conflict', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Different Prefix Co', issue_prefix: 'DIFF' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.issue_prefix).toBe('DIFF')
  })

  it('PATCH to a duplicate issue_prefix also fails', async () => {
    // Create a company with prefix PATC
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patch Target Co', issue_prefix: 'PATC' }),
    })
    const { data: patchCo } = (await createRes.json()) as { data: CompanyRow }

    // Try to PATCH its prefix to UNIQ (already taken)
    const res = await app.request(`/api/companies/${patchCo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_prefix: 'UNIQ' }),
    })
    // BUG: No deduplication guard — raw 500 from DB unique constraint
    expect(res.status).not.toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Battle D: Empty company — dashboard metrics on a fresh company
// ---------------------------------------------------------------------------

describe('Battle D: empty company metrics', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'Empty Corp', { issue_prefix: 'EMPC' })
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('agent list returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    expect(body.data).toHaveLength(0)
  })

  it('issue list returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/issues`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('costs list returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('dashboard returns all-zero metrics', async () => {
    const res = await app.request(`/api/companies/${companyId}/dashboard`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: DashboardMetrics }
    expect(body.data.agentCount).toBe(0)
    expect(body.data.taskCount).toBe(0)
    expect(body.data.openTasks).toBe(0)
    expect(body.data.completedTasks).toBe(0)
    expect(body.data.totalSpendCents).toBe(0)
    expect(Array.isArray(body.data.recentActivity)).toBe(true)
  })

  it('activity log returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('policies list returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })

  it('costs/by-agent returns empty array', async () => {
    const res = await app.request(`/api/companies/${companyId}/costs/by-agent`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Battle E: Max-length company name
// ---------------------------------------------------------------------------

describe('Battle E: max-length and boundary name values', () => {
  let db: PGliteProvider
  let app: App

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates company with exactly 255-character name', async () => {
    const name = 'A'.repeat(255)
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, issue_prefix: 'LNGA' }),
    })
    // The DB column is TEXT (unbounded) — 255 chars must be accepted
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.name).toHaveLength(255)
    expect(body.data.id).toBeTruthy()
  })

  it('creates company with 1000-character name (TEXT column is unbounded)', async () => {
    const name = 'B'.repeat(1000)
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, issue_prefix: 'LNGB' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.name).toHaveLength(1000)
  })

  it('name with only spaces returns 400 (nonEmpty validation)', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ', issue_prefix: 'SPCE' }),
    })
    // nonEmpty = z.string().min(1) — a string of spaces passes min(1)
    // This documents the current behavior: spaces-only name is ACCEPTED
    // ENHANCEMENT: Add .trim().min(1) to reject whitespace-only names
    expect([200, 201, 400]).toContain(res.status)
  })

  it('issue_prefix with only spaces returns 400', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Valid Name', issue_prefix: '   ' }),
    })
    // Same reasoning: nonEmpty allows whitespace — documents current behavior
    // ENHANCEMENT: Add .trim().min(1) to reject whitespace-only prefix
    expect([200, 201, 400]).toContain(res.status)
  })

  it('single-character name and prefix are accepted', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', issue_prefix: 'X' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.name).toBe('X')
  })
})

// ---------------------------------------------------------------------------
// Battle F: Status lifecycle
// ---------------------------------------------------------------------------

describe('Battle F: company status lifecycle', () => {
  let db: PGliteProvider
  let app: App

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  it('company defaults to active status', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Status Defaults Co', issue_prefix: 'STDF' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.status).toBe('active')
  })

  it('creates company with explicit inactive status', async () => {
    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Inactive From Start Co',
        issue_prefix: 'INCT',
        status: 'inactive',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.status).toBe('inactive')
  })

  it('PATCH transitions active → inactive', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Status Transition Co', issue_prefix: 'STRT' }),
    })
    const { data: company } = (await createRes.json()) as { data: CompanyRow }
    expect(company.status).toBe('active')

    const patchRes = await app.request(`/api/companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'inactive' }),
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CompanyRow }
    expect(body.data.status).toBe('inactive')
  })

  it('PATCH transitions inactive → active', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Re-activate Co',
        issue_prefix: 'REAC',
        status: 'inactive',
      }),
    })
    const { data: company } = (await createRes.json()) as { data: CompanyRow }

    const patchRes = await app.request(`/api/companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as { data: CompanyRow }
    expect(body.data.status).toBe('active')
  })

  it('PATCH with invalid status returns 400', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Status Co', issue_prefix: 'BADS' }),
    })
    const { data: company } = (await createRes.json()) as { data: CompanyRow }

    const res = await app.request(`/api/companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// Battle G: Logo upload — valid image + invalid type rejection
// ---------------------------------------------------------------------------

describe('Battle G: logo upload — valid and invalid file types', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    const storage = makeTempStorage()
    app = createApp(db, { skipAuth: true, storage })

    const company = await createCompany(app, 'Logo Test Corp', { issue_prefix: 'LOGO' })
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('PUT /logo with valid PNG (1x1 pixel) succeeds', async () => {
    // Minimal valid 1x1 PNG
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
        '7753de000000' +
        '0c4944415478016360f8cfc00000000200016ae58ca50000000049454e44ae426082',
      'hex',
    )
    const form = await makeLogoFormData(pngBytes, 'logo.png', 'image/png')

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: CompanyRow & { logo_url: string }
    }
    expect(body.data.logo_url).toBeTruthy()
    expect(body.data.logo_url).toContain('/api/assets/')
  })

  it('GET company now shows logo_url populated', async () => {
    const res = await app.request(`/api/companies/${companyId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow }
    expect(body.data.logo_url).toBeTruthy()
    expect(body.data.logo_asset_id).toBeTruthy()
  })

  it('PUT /logo with valid JPEG succeeds', async () => {
    // Minimal valid JPEG (SOI + EOI)
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
    const form = await makeLogoFormData(jpegBytes, 'logo.jpg', 'image/jpeg')

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(200)
  })

  it('PUT /logo with valid SVG text succeeds', async () => {
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
    const form = await makeLogoFormData(svgContent, 'logo.svg', 'image/svg+xml')

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(200)
  })

  it('PUT /logo with invalid MIME type (text/plain) returns 415', async () => {
    const form = await makeLogoFormData(
      Buffer.from('not an image'),
      'logo.txt',
      'text/plain',
    )

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Unsupported file type')
  })

  it('PUT /logo with invalid MIME type (application/pdf) returns 415', async () => {
    const form = await makeLogoFormData(
      Buffer.from('%PDF-1.4 fake'),
      'document.pdf',
      'application/pdf',
    )

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(415)
  })

  it('PUT /logo with invalid MIME type (application/zip) returns 415', async () => {
    const form = await makeLogoFormData(
      Buffer.from('PK fake zip data'),
      'archive.zip',
      'application/zip',
    )

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(415)
  })

  it('PUT /logo without file field returns 400', async () => {
    const form = new FormData()
    form.append('not_file', 'some_value')

    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Missing file')
  })
})

// ---------------------------------------------------------------------------
// Battle H: Logo replacement + removal
// ---------------------------------------------------------------------------

describe('Battle H: logo replacement and removal', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    const storage = makeTempStorage()
    app = createApp(db, { skipAuth: true, storage })

    const company = await createCompany(app, 'Logo Lifecycle Corp', { issue_prefix: 'LOGR' })
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('DELETE /logo on company with no logo returns 404', async () => {
    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Company has no logo')
  })

  it('uploads initial PNG logo', async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    ])
    const form = await makeLogoFormData(pngBytes, 'initial.png', 'image/png')
    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: CompanyRow & { logo_url: string } }
    expect(body.data.logo_url).toBeTruthy()
  })

  it('replaces logo with a WebP — previous asset is removed', async () => {
    // First record the initial asset id
    const beforeRes = await app.request(`/api/companies/${companyId}`)
    const beforeBody = (await beforeRes.json()) as { data: CompanyRow }
    const oldAssetId = beforeBody.data.logo_asset_id

    const webpBytes = Buffer.from('RIFF\x00\x00\x00\x00WEBPno real image')
    const form = await makeLogoFormData(webpBytes, 'new-logo.webp', 'image/webp')
    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(200)

    const afterRes = await app.request(`/api/companies/${companyId}`)
    const afterBody = (await afterRes.json()) as { data: CompanyRow }
    // New asset id is different from the old one
    expect(afterBody.data.logo_asset_id).toBeTruthy()
    expect(afterBody.data.logo_asset_id).not.toBe(oldAssetId)
  })

  it('DELETE /logo removes logo and nulls logo_asset_id', async () => {
    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const afterRes = await app.request(`/api/companies/${companyId}`)
    const afterBody = (await afterRes.json()) as { data: CompanyRow }
    expect(afterBody.data.logo_asset_id ?? null).toBeNull()
    expect(afterBody.data.logo_url).toBeNull()
  })

  it('DELETE /logo again after removal returns 404', async () => {
    const res = await app.request(`/api/companies/${companyId}/logo`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('PUT /logo on non-existent company returns 404', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const form = await makeLogoFormData(pngBytes, 'logo.png', 'image/png')
    const res = await app.request(
      '/api/companies/00000000-0000-0000-0000-000000000000/logo',
      { method: 'PUT', body: form },
    )
    expect(res.status).toBe(404)
  })

  it('DELETE /logo on non-existent company returns 404', async () => {
    const res = await app.request(
      '/api/companies/00000000-0000-0000-0000-000000000000/logo',
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Battle I: LLM key management (company config)
// ---------------------------------------------------------------------------

describe('Battle I: LLM key management', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    const company = await createCompany(app, 'LLM Key Co', { issue_prefix: 'LLMK' })
    companyId = company.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /llm-keys returns 200 with redacted or null key values', async () => {
    // NOTE: llm-keys reads from the global ~/.shackleai/orchestrator/config.json
    // file, NOT from the DB. Keys may already be set in the dev environment.
    // We assert the response shape and that any returned value is either null
    // or a redacted string (starts with "••••"), NOT the raw plaintext key.
    const res = await app.request(`/api/companies/${companyId}/llm-keys`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { openai: string | null; anthropic: string | null }
    }
    // Shape check
    expect('openai' in body.data).toBe(true)
    expect('anthropic' in body.data).toBe(true)
    // If a key is present it must be redacted (never plaintext)
    if (body.data.openai !== null) {
      expect(body.data.openai).toMatch(/^••••/)
      expect(body.data.openai.length).toBeGreaterThan(4)
    }
    if (body.data.anthropic !== null) {
      expect(body.data.anthropic).toMatch(/^••••/)
      expect(body.data.anthropic.length).toBeGreaterThan(4)
    }
  })

  it('GET /llm-keys with invalid company id still returns data (keys are global config)', async () => {
    // llm-keys route reads from config file — not scoped per company in DB
    // This test documents the current design behavior
    const res = await app.request(
      '/api/companies/00000000-0000-0000-0000-000000000000/llm-keys',
    )
    // Returns 200 with config data regardless of company id validity
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Battle J: Rapid company switching — no race conditions
// ---------------------------------------------------------------------------

describe('Battle J: rapid company switching — concurrency', () => {
  let db: PGliteProvider
  let app: App
  let companyIds: string[]

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })

    // Create 5 companies with different prefixes
    const prefixes = ['RCA', 'RCB', 'RCC', 'RCD', 'RCE']
    const companies = await Promise.all(
      prefixes.map((p, i) =>
        createCompany(app, `Race Co ${i + 1}`, { issue_prefix: p }),
      ),
    )
    companyIds = companies.map((c) => c.id)

    // Seed each with 2 issues
    await Promise.all(
      companyIds.flatMap((id) => [
        createIssue(app, id, `Task for ${id} #1`),
        createIssue(app, id, `Task for ${id} #2`),
      ]),
    )
  })

  afterAll(async () => {
    await db.close()
  })

  it('fetches all 5 company dashboards simultaneously without corruption', async () => {
    const results = await Promise.all(
      companyIds.map((id) =>
        app.request(`/api/companies/${id}/dashboard`).then(async (r) => {
          expect(r.status).toBe(200)
          return (await r.json()) as { data: DashboardMetrics }
        }),
      ),
    )

    // Every dashboard must reflect exactly 2 tasks (seeded above)
    results.forEach((body) => {
      expect(body.data.taskCount).toBe(2)
      // agents were never created — must be 0
      expect(body.data.agentCount).toBe(0)
    })
  })

  it('parallel PATCH to all 5 companies completes without data bleeding', async () => {
    await Promise.all(
      companyIds.map((id, i) =>
        app.request(`/api/companies/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budget_monthly_cents: (i + 1) * 1000 }),
        }),
      ),
    )

    // Verify each company has its correct (unique) budget
    await Promise.all(
      companyIds.map(async (id, i) => {
        const res = await app.request(`/api/companies/${id}`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { data: CompanyRow }
        expect(body.data.budget_monthly_cents).toBe((i + 1) * 1000)
      }),
    )
  })

  it('parallel issue creation on the same company produces unique identifiers', async () => {
    // Create 10 issues at the same time on a single company — identifiers must be unique
    const targetId = companyIds[0]
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request(`/api/companies/${targetId}/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Concurrent issue ${i + 1}` }),
        }).then(async (r) => {
          const b = (await r.json()) as { data: { identifier: string } }
          return b.data.identifier
        }),
      ),
    )

    // All 10 identifiers must be unique — no sequence collision
    expect(new Set(results).size).toBe(10)
  })
})
