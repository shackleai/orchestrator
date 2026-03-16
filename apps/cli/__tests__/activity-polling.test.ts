/**
 * Tests for enhanced activity polling API — since, agentId, limit query params.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: ReturnType<typeof createApp>, name = 'Poll Corp') {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: name.toUpperCase().slice(0, 4) }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function insertActivityLog(
  db: PGliteProvider,
  companyId: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO activity_log
       (company_id, entity_type, entity_id, actor_type, actor_id, action, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      companyId,
      overrides.entity_type ?? 'agent',
      overrides.entity_id ?? null,
      overrides.actor_type ?? 'system',
      overrides.actor_id ?? null,
      overrides.action ?? 'created',
      overrides.created_at ?? new Date().toISOString(),
    ],
  )
  return result.rows[0].id
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('activity polling routes', () => {
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

  it('filters by since (ISO timestamp)', async () => {
    const cid = await createCompany(app, 'Since Corp')

    await insertActivityLog(db, cid, {
      action: 'old_action',
      created_at: '2025-01-01T00:00:00.000Z',
    })
    await insertActivityLog(db, cid, {
      action: 'new_action',
      created_at: '2025-06-15T00:00:00.000Z',
    })

    const res = await app.request(
      `/api/companies/${cid}/activity?since=2025-06-01T00:00:00.000Z`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { action: string }[] }

    const actions = body.data.map((e) => e.action)
    expect(actions).toContain('new_action')
    expect(actions).not.toContain('old_action')
  })

  it('filters by agentId (actor_id)', async () => {
    const cid = await createCompany(app, 'AgentFilter Corp')
    const agentA = '00000000-0000-4000-a000-aaaaaaaaaaaa'
    const agentB = '00000000-0000-4000-a000-bbbbbbbbbbbb'

    await insertActivityLog(db, cid, { actor_id: agentA, action: 'agent_a_action' })
    await insertActivityLog(db, cid, { actor_id: agentB, action: 'agent_b_action' })

    const res = await app.request(
      `/api/companies/${cid}/activity?agentId=${agentA}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { action: string }[] }

    const actions = body.data.map((e) => e.action)
    expect(actions).toContain('agent_a_action')
    expect(actions).not.toContain('agent_b_action')
  })

  it('respects limit parameter', async () => {
    const cid = await createCompany(app, 'Limit Corp')

    // Insert 10 entries
    for (let i = 0; i < 10; i++) {
      await insertActivityLog(db, cid, { action: `action_${i}` })
    }

    const res = await app.request(`/api/companies/${cid}/activity?limit=3`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(3)
  })

  it('caps limit at 50 even if higher is requested', async () => {
    const cid = await createCompany(app, 'MaxLimit Corp')

    // Insert 60 entries
    for (let i = 0; i < 60; i++) {
      await insertActivityLog(db, cid, { action: `bulk_${i}` })
    }

    const res = await app.request(`/api/companies/${cid}/activity?limit=100`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeLessThanOrEqual(50)
  })

  it('defaults to 50 results when no limit is provided', async () => {
    const cid = await createCompany(app, 'DefaultLimit Corp')

    // Insert 60 entries
    for (let i = 0; i < 60; i++) {
      await insertActivityLog(db, cid, { action: `default_${i}` })
    }

    const res = await app.request(`/api/companies/${cid}/activity`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeLessThanOrEqual(50)
  })

  it('combines since and agentId filters', async () => {
    const cid = await createCompany(app, 'Combined Corp')
    const agentX = '00000000-0000-4000-a000-xxxxxxxxxxxx'

    await insertActivityLog(db, cid, {
      actor_id: agentX,
      action: 'old_by_x',
      created_at: '2025-01-01T00:00:00.000Z',
    })
    await insertActivityLog(db, cid, {
      actor_id: agentX,
      action: 'new_by_x',
      created_at: '2025-07-01T00:00:00.000Z',
    })
    await insertActivityLog(db, cid, {
      actor_id: null,
      action: 'new_by_system',
      created_at: '2025-07-01T00:00:00.000Z',
    })

    const res = await app.request(
      `/api/companies/${cid}/activity?since=2025-06-01T00:00:00.000Z&agentId=${agentX}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { action: string }[] }

    const actions = body.data.map((e) => e.action)
    expect(actions).toContain('new_by_x')
    expect(actions).not.toContain('old_by_x')
    expect(actions).not.toContain('new_by_system')
  })

  it('ignores invalid limit values', async () => {
    const cid = await createCompany(app, 'BadLimit Corp')
    await insertActivityLog(db, cid, { action: 'something' })

    // Invalid limit falls back to 50
    const res = await app.request(`/api/companies/${cid}/activity?limit=abc`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })
})
