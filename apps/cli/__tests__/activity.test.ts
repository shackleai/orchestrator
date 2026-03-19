import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

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

// Insert an activity log entry directly via db — activity_log is an audit log,
// entries are written by the system (triggers, hooks), not via this API.
async function insertActivityLog(
  db: PGliteProvider,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO activity_log
       (company_id, entity_type, entity_id, actor_type, actor_id, action)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      companyId,
      overrides.entity_type ?? 'agent',
      overrides.entity_id ?? null,
      overrides.actor_type ?? 'system',
      overrides.actor_id ?? null,
      overrides.action ?? 'created',
    ],
  )
  return result.rows[0].id
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('activity routes', () => {
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

  it('GET /api/companies/:id/activity returns empty array on fresh company', async () => {
    const res = await app.request(`/api/companies/${companyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('GET /api/companies/:id/activity returns 404 for non-existent company', async () => {
    const res = await app.request(
      `/api/companies/00000000-0000-0000-0000-000000000000/activity`,
    )
    expect(res.status).toBe(404)
  })

  it('GET /api/companies/:id/activity lists activity log entries', async () => {
    const newCompanyId = await createCompany(app, 'Activity List Corp')

    await insertActivityLog(db, newCompanyId, { entity_type: 'agent', action: 'created' })
    await insertActivityLog(db, newCompanyId, { entity_type: 'issue', action: 'closed' })

    const res = await app.request(`/api/companies/${newCompanyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('GET /api/companies/:id/activity filters by entity_type', async () => {
    const newCompanyId = await createCompany(app, 'ActFilter Corp')

    await insertActivityLog(db, newCompanyId, { entity_type: 'agent', action: 'created' })
    await insertActivityLog(db, newCompanyId, { entity_type: 'issue', action: 'created' })
    await insertActivityLog(db, newCompanyId, { entity_type: 'issue', action: 'closed' })

    const res = await app.request(
      `/api/companies/${newCompanyId}/activity?entity_type=issue`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { entity_type: string }[]
    }
    expect(body.data).toHaveLength(2)
    expect(body.data.every((e) => e.entity_type === 'issue')).toBe(true)
  })

  it('GET /api/companies/:id/activity returns correct shape', async () => {
    const newCompanyId = await createCompany(app, 'ActShape Corp')
    await insertActivityLog(db, newCompanyId, {
      entity_type: 'policy',
      actor_type: 'agent',
      action: 'updated',
    })

    const res = await app.request(`/api/companies/${newCompanyId}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        id: string
        company_id: string
        entity_type: string
        actor_type: string
        action: string
        created_at: string
      }[]
    }
    const entry = body.data[0]
    expect(entry.id).toBeTruthy()
    expect(entry.company_id).toBe(newCompanyId)
    expect(entry.entity_type).toBe('policy')
    expect(entry.actor_type).toBe('agent')
    expect(entry.action).toBe('updated')
  })
})
