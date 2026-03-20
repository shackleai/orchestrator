/**
 * E2E: Governance — policy enforcement
 *
 * Tests policy CRUD and priority ordering:
 *   company → deny policy → allow policy → verify order
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../../apps/cli/src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PolicyRow = {
  id: string
  company_id: string
  name: string
  tool_pattern: string
  action: string
  priority: number
  agent_id: string | null
  max_calls_per_hour: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: ReturnType<typeof createApp>, name = 'Gov Corp'): Promise<string> {
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: name.toUpperCase().slice(0, 4) }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createPolicy(
  app: ReturnType<typeof createApp>,
  companyId: string,
  overrides: Record<string, unknown>,
): Promise<PolicyRow> {
  const res = await app.request(`/api/companies/${companyId}/policies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: PolicyRow }
  return body.data
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('E2E: governance — policy enforcement', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let denyPolicyId: string
  let allowPolicyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Gov Corp')
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates a deny-all policy via POST /api/companies/:id/policies', async () => {
    const policy = await createPolicy(app, companyId, {
      name: 'deny-all',
      tool_pattern: '*',
      action: 'deny',
      priority: 10,
    })

    expect(policy.name).toBe('deny-all')
    expect(policy.tool_pattern).toBe('*')
    expect(policy.action).toBe('deny')
    expect(policy.priority).toBe(10)
    expect(policy.company_id).toBe(companyId)
    expect(policy.agent_id).toBeNull()

    denyPolicyId = policy.id
  })

  it('verifies deny policy appears in GET /api/companies/:id/policies', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(denyPolicyId)
    expect(body.data[0].action).toBe('deny')
  })

  it('creates an allow policy with higher priority via POST /api/companies/:id/policies', async () => {
    const policy = await createPolicy(app, companyId, {
      name: 'allow-web-search',
      tool_pattern: 'web_search',
      action: 'allow',
      priority: 100,
    })

    expect(policy.name).toBe('allow-web-search')
    expect(policy.tool_pattern).toBe('web_search')
    expect(policy.action).toBe('allow')
    expect(policy.priority).toBe(100)

    allowPolicyId = policy.id
  })

  it('verifies both policies exist via GET /api/companies/:id/policies', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    expect(body.data.length).toBe(2)
  })

  it('policies are ordered by priority DESC (allow=100 first, deny=10 second)', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }

    // Ordered by priority DESC — higher priority first
    expect(body.data[0].priority).toBeGreaterThan(body.data[1].priority)
    expect(body.data[0].action).toBe('allow')
    expect(body.data[1].action).toBe('deny')
  })

  it('updates the deny policy priority via PATCH /api/companies/:id/policies/:policyId', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/${denyPolicyId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 5 }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow }
    expect(body.data.priority).toBe(5)
  })

  it('returns 404 for PATCH on non-existent policy', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 1 }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('deletes the allow policy via DELETE /api/companies/:id/policies/:policyId', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/${allowPolicyId}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deleted: boolean; id: string } }
    expect(body.data.deleted).toBe(true)
    expect(body.data.id).toBe(allowPolicyId)
  })

  it('only deny policy remains after deletion', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: PolicyRow[] }
    expect(body.data.length).toBe(1)
    expect(body.data[0].id).toBe(denyPolicyId)
  })

  it('returns 404 for DELETE on non-existent policy', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/policies/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 on POST with missing required fields', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Missing name, tool_pattern, action
      body: JSON.stringify({ priority: 5 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 on POST with invalid action value', async () => {
    const res = await app.request(`/api/companies/${companyId}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bad-action',
        tool_pattern: '*',
        action: 'block', // not a valid PolicyAction
        priority: 1,
      }),
    })
    expect(res.status).toBe(400)
  })
})
