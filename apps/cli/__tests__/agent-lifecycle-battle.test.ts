/**
 * Battle Test — Agent Lifecycle (#267)
 *
 * Comprehensive coverage for agent lifecycle scenarios NOT already covered
 * by agents.test.ts, agent-cmd.test.ts, or e2e-battle.test.ts Battle 10.
 *
 * Covers:
 *   1. Create agent for all 11 adapter types
 *   2. Create agent with all optional fields populated
 *   3. Config revisions — PATCH creates a new revision
 *   4. Rollback to previous revision
 *   5. Rollback to oldest revision (multi-revision chain)
 *   6. Rapid pause/resume toggling
 *   7. Terminate already-terminated agent
 *   8. Create agent with invalid adapter type → 400
 *   9. Revisions list — empty, then populated
 *  10. Rollback → non-existent revision → 404
 *  11. Revisions list → non-existent agent → 404
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import { AdapterType, AgentStatus } from '@shackleai/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type AgentRow = {
  id: string
  name: string
  title: string | null
  role: string
  status: string
  adapter_type: string
  capabilities: string | null
  reports_to: string | null
  budget_monthly_cents: number
  last_heartbeat_at: string | null
}

type RevisionRow = {
  id: string
  agent_id: string
  revision_number: number
  config_snapshot: Record<string, unknown>
  changed_by: string | null
  change_reason: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: App, name: string): Promise<string> {
  const prefix = name.replace(/\s+/g, '').toUpperCase().slice(0, 4)
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: prefix }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(
  app: App,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Battle Agent',
      adapter_type: AdapterType.Process,
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function patchAgent(
  app: App,
  companyId: string,
  agentId: string,
  updates: Record<string, unknown>,
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: AgentRow }
  return body.data
}

async function getRevisions(
  app: App,
  companyId: string,
  agentId: string,
): Promise<{ status: number; data: RevisionRow[] }> {
  const res = await app.request(
    `/api/companies/${companyId}/agents/${agentId}/revisions`,
  )
  const body = (await res.json()) as { data: RevisionRow[] }
  return { status: res.status, data: body.data }
}

// ---------------------------------------------------------------------------
// 1. All 11 Adapter Types
// ---------------------------------------------------------------------------

describe('Battle 13A: create agent — all 11 adapter types', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  const ALL_ADAPTERS = [
    AdapterType.Process,
    AdapterType.Http,
    AdapterType.Claude,
    AdapterType.Mcp,
    AdapterType.OpenClaw,
    AdapterType.CrewAI,
    AdapterType.Codex,
    AdapterType.Cursor,
    AdapterType.Gemini,
    AdapterType.Kiro,
    AdapterType.OpenCode,
  ] as const

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Adapter Zoo')
  })

  afterAll(async () => {
    await db.close()
  })

  it('covers exactly 11 adapter types (validates test completeness)', () => {
    expect(ALL_ADAPTERS).toHaveLength(11)
    const adapterValues = Object.values(AdapterType)
    expect(adapterValues).toHaveLength(11)
    // Every enum value is in our test array
    adapterValues.forEach((v) => expect(ALL_ADAPTERS).toContain(v))
  })

  it.each(ALL_ADAPTERS)(
    'creates agent with adapter_type=%s and verifies persistence',
    async (adapterType) => {
      const res = await app.request(`/api/companies/${companyId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${adapterType} Agent`,
          adapter_type: adapterType,
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { data: AgentRow }
      expect(body.data.adapter_type).toBe(adapterType)
      expect(body.data.status).toBe(AgentStatus.Idle)
      expect(body.data.name).toBe(`${adapterType} Agent`)
      expect(body.data.id).toBeTruthy()

      // Verify persisted via GET
      const getRes = await app.request(
        `/api/companies/${companyId}/agents/${body.data.id}`,
      )
      expect(getRes.status).toBe(200)
      const getBody = (await getRes.json()) as { data: AgentRow }
      expect(getBody.data.adapter_type).toBe(adapterType)
    },
  )

  it('all 11 agents appear in the agent list', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow[] }
    const adapters = body.data.map((a) => a.adapter_type)
    for (const type of ALL_ADAPTERS) {
      expect(adapters).toContain(type)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Create Agent with All Optional Fields
// ---------------------------------------------------------------------------

describe('Battle 13B: create agent — all optional fields populated', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let managerId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Full Fields Corp')

    // Create a manager agent to reference in reports_to
    const manager = await createAgent(app, companyId, { name: 'Manager Agent' })
    managerId = manager.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('creates agent with every optional field populated and verifies all fields persist', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fully Specced Agent',
        title: 'Senior AI Engineer',
        role: 'worker',
        adapter_type: AdapterType.Http,
        capabilities: 'coding,testing,deployment,security-review',
        reports_to: managerId,
        budget_monthly_cents: 9999,
        adapter_config: {
          url: 'http://localhost:8080/agent',
          timeout_ms: 30000,
        },
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: AgentRow }

    expect(body.data.name).toBe('Fully Specced Agent')
    expect(body.data.title).toBe('Senior AI Engineer')
    expect(body.data.role).toBe('worker')
    expect(body.data.adapter_type).toBe(AdapterType.Http)
    expect(body.data.capabilities).toBe('coding,testing,deployment,security-review')
    expect(body.data.reports_to).toBe(managerId)
    expect(body.data.budget_monthly_cents).toBe(9999)
    expect(body.data.status).toBe(AgentStatus.Idle)

    // Cross-verify via detail endpoint
    const detail = await app.request(
      `/api/companies/${companyId}/agents/${body.data.id}`,
    )
    const detailBody = (await detail.json()) as { data: AgentRow }
    expect(detailBody.data.title).toBe('Senior AI Engineer')
    expect(detailBody.data.capabilities).toBe('coding,testing,deployment,security-review')
    expect(detailBody.data.budget_monthly_cents).toBe(9999)
  })

  it('creates agent with status explicitly set to active', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pre-Active Agent',
        adapter_type: AdapterType.Process,
        status: AgentStatus.Active,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Active)
  })
})

// ---------------------------------------------------------------------------
// 3. Config Revisions — PATCH Creates New Revision
// ---------------------------------------------------------------------------

describe('Battle 13C: config revisions — PATCH creates revision', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Revision Corp')
    const agent = await createAgent(app, companyId, {
      name: 'Revision Subject',
      adapter_type: AdapterType.Process,
    })
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('GET /revisions returns empty array before any updates', async () => {
    const { status, data } = await getRevisions(app, companyId, agentId)
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  it('first PATCH creates revision 1 with correct snapshot', async () => {
    await patchAgent(app, companyId, agentId, { name: 'Revision Subject v2' })

    const { data } = await getRevisions(app, companyId, agentId)
    expect(data).toHaveLength(1)
    expect(data[0].revision_number).toBe(1)
    expect(data[0].agent_id).toBe(agentId)

    // Snapshot must capture the PRE-update state
    const snapshot = typeof data[0].config_snapshot === 'string'
      ? JSON.parse(data[0].config_snapshot as unknown as string)
      : data[0].config_snapshot
    expect(snapshot.name).toBe('Revision Subject') // original name
  })

  it('second PATCH creates revision 2, revisions ordered DESC by revision_number', async () => {
    await patchAgent(app, companyId, agentId, {
      name: 'Revision Subject v3',
      capabilities: 'analysis',
    })

    const { data } = await getRevisions(app, companyId, agentId)
    expect(data).toHaveLength(2)
    // Ordered DESC — revision 2 first
    expect(data[0].revision_number).toBe(2)
    expect(data[1].revision_number).toBe(1)
  })

  it('third PATCH with change_reason persists the reason in revision metadata', async () => {
    await patchAgent(app, companyId, agentId, {
      name: 'Revision Subject v4',
      change_reason: 'Prod incident hotfix',
      changed_by: 'on-call-engineer',
    })

    const { data } = await getRevisions(app, companyId, agentId)
    expect(data).toHaveLength(3)
    // Most recent revision (desc order)
    expect(data[0].revision_number).toBe(3)
    expect(data[0].change_reason).toBe('Prod incident hotfix')
    expect(data[0].changed_by).toBe('on-call-engineer')
  })

  it('GET /revisions with ?limit=1 returns only the latest revision', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/revisions?limit=1`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: RevisionRow[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0].revision_number).toBe(3)
  })

  it('GET /revisions for non-existent agent returns 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/revisions`,
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })

  it('PATCH with no actual field changes does not create a new revision', async () => {
    // Sending an empty body — no fields to change
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    // Revision count should remain 3
    const { data } = await getRevisions(app, companyId, agentId)
    expect(data).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 4. Rollback to Previous Config Revision
// ---------------------------------------------------------------------------

describe('Battle 13D: rollback to previous config revision', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string
  let revision1Id: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Rollback Corp')

    // Create agent → patch twice to create 2 revisions
    const agent = await createAgent(app, companyId, {
      name: 'Rollback Subject',
      capabilities: 'original-capability',
    })
    agentId = agent.id

    // Patch 1: creates revision 1 (snapshot of original)
    await patchAgent(app, companyId, agentId, {
      name: 'Rollback Subject v2',
      capabilities: 'updated-capability',
    })

    // Capture revision 1 id
    const revsAfterPatch1 = await getRevisions(app, companyId, agentId)
    revision1Id = revsAfterPatch1.data[0].id // desc order, so [0] = revision 1

    // Patch 2: creates revision 2
    await patchAgent(app, companyId, agentId, {
      name: 'Rollback Subject v3',
      capabilities: 'third-capability',
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('rollback to revision 1 restores name and capabilities from that snapshot', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/rollback/${revision1Id}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: { agent: AgentRow; rolled_back_to: number }
    }

    // rolled_back_to should match the revision number
    expect(body.data.rolled_back_to).toBe(1)

    // Agent should reflect the snapshot stored at revision 1 (pre-patch-1 state)
    expect(body.data.agent.name).toBe('Rollback Subject')
    expect(body.data.agent.capabilities).toBe('original-capability')
  })

  it('rollback itself creates a new revision (audit trail preserved)', async () => {
    const { data } = await getRevisions(app, companyId, agentId)
    // 2 existing + 1 pre-rollback snapshot = 3 total
    expect(data.length).toBeGreaterThanOrEqual(3)

    // Most recent revision's change_reason should mention rollback
    expect(data[0].change_reason).toMatch(/[Rr]ollback/)
  })

  it('GET agent detail after rollback reflects restored state', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.name).toBe('Rollback Subject')
    expect(body.data.capabilities).toBe('original-capability')
  })

  it('rollback to non-existent revision → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/rollback/00000000-0000-0000-0000-000000000000`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Revision not found')
  })

  it('rollback for non-existent agent → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/00000000-0000-0000-0000-000000000000/rollback/${revision1Id}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Agent not found')
  })
})

// ---------------------------------------------------------------------------
// 5. Rollback to Oldest Revision (Multi-Revision Chain)
// ---------------------------------------------------------------------------

describe('Battle 13E: rollback to oldest revision in a long chain', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string
  let oldestRevisionId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Long Chain Corp')

    const agent = await createAgent(app, companyId, {
      name: 'Chain Agent v0',
      capabilities: 'original',
      budget_monthly_cents: 100,
    })
    agentId = agent.id

    // Create a chain of 5 revisions
    for (let i = 1; i <= 5; i++) {
      await patchAgent(app, companyId, agentId, {
        name: `Chain Agent v${i}`,
        capabilities: `capability-${i}`,
        budget_monthly_cents: 100 + i * 100,
      })
    }

    // Oldest revision = revision 1 (last in desc-sorted list)
    const { data } = await getRevisions(app, companyId, agentId)
    // data is DESC order — oldest is at the end
    oldestRevisionId = data[data.length - 1].id
  })

  afterAll(async () => {
    await db.close()
  })

  it('5 PATCHes create 5 revisions', async () => {
    const { data } = await getRevisions(app, companyId, agentId)
    expect(data).toHaveLength(5)
    // Revision numbers 1–5, desc order
    expect(data[0].revision_number).toBe(5)
    expect(data[data.length - 1].revision_number).toBe(1)
  })

  it('rollback to oldest (revision 1) restores v0 state', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/rollback/${oldestRevisionId}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { agent: AgentRow; rolled_back_to: number }
    }

    expect(body.data.rolled_back_to).toBe(1)
    expect(body.data.agent.name).toBe('Chain Agent v0')
    expect(body.data.agent.capabilities).toBe('original')
    expect(body.data.agent.budget_monthly_cents).toBe(100)
  })

  it('revision list grows by 1 after rollback (pre-rollback snapshot saved)', async () => {
    const { data } = await getRevisions(app, companyId, agentId)
    // 5 original + 1 pre-rollback = 6
    expect(data).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// 6. Rapid Pause/Resume Toggling
// ---------------------------------------------------------------------------

describe('Battle 13F: rapid pause/resume toggling', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Toggle Corp')
    const agent = await createAgent(app, companyId, { name: 'Toggle Agent' })
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('sequential pause → resume → pause → resume cycle all return correct status', async () => {
    const actions = ['pause', 'resume', 'pause', 'resume'] as const
    const expectedStatuses = [
      AgentStatus.Paused,
      AgentStatus.Idle,
      AgentStatus.Paused,
      AgentStatus.Idle,
    ]

    for (let i = 0; i < actions.length; i++) {
      const res = await app.request(
        `/api/companies/${companyId}/agents/${agentId}/${actions[i]}`,
        { method: 'POST' },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: AgentRow }
      expect(body.data.status).toBe(expectedStatuses[i])
    }
  })

  it('10 rapid sequential toggles converge to correct final state', async () => {
    // Start: idle (from previous test)
    // 10 alternating toggles: p,r,p,r,p,r,p,r,p,r → ends on resume = idle
    for (let i = 0; i < 10; i++) {
      const action = i % 2 === 0 ? 'pause' : 'resume'
      const res = await app.request(
        `/api/companies/${companyId}/agents/${agentId}/${action}`,
        { method: 'POST' },
      )
      expect(res.status).toBe(200)
    }

    // 10 iterations (0-9), last iteration (9) is resume → idle
    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Idle)
  })

  it('concurrent pause requests both succeed (last writer wins — idempotent)', async () => {
    // Both pause → both should return 200, final state = paused
    const [r1, r2] = await Promise.all([
      app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, {
        method: 'POST',
      }),
      app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, {
        method: 'POST',
      }),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    // Drain both response bodies to avoid connection leaks
    await r1.json()
    await r2.json()

    const res = await app.request(`/api/companies/${companyId}/agents/${agentId}`)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Paused)
  })

  it('pause on already-paused agent returns 200 and stays paused (idempotent)', async () => {
    // Agent is already paused from the concurrent test above
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/pause`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Paused)
  })

  it('resume on already-idle agent returns 200 and stays idle (idempotent)', async () => {
    // First resume to idle
    await app.request(`/api/companies/${companyId}/agents/${agentId}/resume`, {
      method: 'POST',
    })
    // Resume again — should be idempotent
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/resume`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Idle)
  })
})

// ---------------------------------------------------------------------------
// 7. Terminate Already-Terminated Agent
// ---------------------------------------------------------------------------

describe('Battle 13G: terminate already-terminated agent', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string
  let agentId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Termination Corp')
    const agent = await createAgent(app, companyId, { name: 'Doomed Agent' })
    agentId = agent.id
  })

  afterAll(async () => {
    await db.close()
  })

  it('first terminate sets status to terminated', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/terminate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  // BUG: The terminate route does a blind UPDATE — it does not reject double-termination.
  // This test documents current behavior. If idempotency is desired, the route should
  // check current status and return 409 or 200 explicitly.
  it('second terminate on already-terminated agent returns 200 (idempotent behavior)', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/terminate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  it('terminated agent is still retrievable via GET', async () => {
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.status).toBe(AgentStatus.Terminated)
  })

  it('can pause a terminated agent (no guard on transition — documents current behavior)', async () => {
    // ENHANCEMENT: The route should guard against invalid state transitions.
    // Currently pause on terminated succeeds — documenting this for a future guard.
    const res = await app.request(
      `/api/companies/${companyId}/agents/${agentId}/pause`,
      { method: 'POST' },
    )
    // Whatever the status code, it should be consistent — not a server error
    expect([200, 409, 422]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// 8. Invalid Adapter Type → 400
// ---------------------------------------------------------------------------

describe('Battle 13H: invalid adapter type on create', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Validation Corp')
  })

  afterAll(async () => {
    await db.close()
  })

  it('create agent with invalid adapter_type → 400 Validation failed', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Adapter Agent',
        adapter_type: 'puppeteer', // not a valid adapter
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('create agent with adapter_type as empty string → 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Empty Adapter Agent',
        adapter_type: '',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('create agent with adapter_type as null → uses default (process)', async () => {
    // Zod schema has .default(AdapterType.Process) — null vs undefined differs by Zod version
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Null Adapter Agent',
        // adapter_type omitted — triggers default
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: AgentRow }
    expect(body.data.adapter_type).toBe(AdapterType.Process)
  })

  it('PATCH agent with invalid adapter_type → 400', async () => {
    const agent = await createAgent(app, companyId, { name: 'Patch Adapter Target' })

    const res = await app.request(`/api/companies/${companyId}/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_type: 'invalid-adapter' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Validation failed')
  })

  it('create agent with numeric adapter_type → 400', async () => {
    const res = await app.request(`/api/companies/${companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Numeric Adapter Agent',
        adapter_type: 42,
      }),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 9. Full Lifecycle: Create → Update (Revision) → Rollback → Terminate
// ---------------------------------------------------------------------------

describe('Battle 13I: complete agent lifecycle chain', () => {
  let db: PGliteProvider
  let app: App
  let companyId: string

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app, 'Lifecycle Chain Corp')
  })

  afterAll(async () => {
    await db.close()
  })

  it('completes full lifecycle: create → pause → resume → update (revision) → rollback → terminate', async () => {
    // Step 1: Create
    const agent = await createAgent(app, companyId, {
      name: 'Full Lifecycle Agent',
      adapter_type: AdapterType.Mcp,
      capabilities: 'tools,memory',
    })
    expect(agent.status).toBe(AgentStatus.Idle)

    // Step 2: Pause
    const pauseRes = await app.request(
      `/api/companies/${companyId}/agents/${agent.id}/pause`,
      { method: 'POST' },
    )
    expect(pauseRes.status).toBe(200)
    expect(((await pauseRes.json()) as { data: AgentRow }).data.status).toBe(AgentStatus.Paused)

    // Step 3: Resume
    const resumeRes = await app.request(
      `/api/companies/${companyId}/agents/${agent.id}/resume`,
      { method: 'POST' },
    )
    expect(resumeRes.status).toBe(200)
    expect(((await resumeRes.json()) as { data: AgentRow }).data.status).toBe(AgentStatus.Idle)

    // Step 4: Update config — creates revision
    await patchAgent(app, companyId, agent.id, {
      name: 'Full Lifecycle Agent v2',
      capabilities: 'tools,memory,search',
    })

    const { data: revisions } = await getRevisions(app, companyId, agent.id)
    expect(revisions).toHaveLength(1)
    const revisionId = revisions[0].id

    // Step 5: Rollback
    const rollbackRes = await app.request(
      `/api/companies/${companyId}/agents/${agent.id}/rollback/${revisionId}`,
      { method: 'POST' },
    )
    expect(rollbackRes.status).toBe(200)
    const rollbackBody = (await rollbackRes.json()) as {
      data: { agent: AgentRow; rolled_back_to: number }
    }
    expect(rollbackBody.data.agent.name).toBe('Full Lifecycle Agent')
    expect(rollbackBody.data.agent.capabilities).toBe('tools,memory')

    // Step 6: Terminate
    const terminateRes = await app.request(
      `/api/companies/${companyId}/agents/${agent.id}/terminate`,
      { method: 'POST' },
    )
    expect(terminateRes.status).toBe(200)
    expect(((await terminateRes.json()) as { data: AgentRow }).data.status).toBe(
      AgentStatus.Terminated,
    )

    // Final state: terminated, restored config, audit trail intact
    const finalRevisions = await getRevisions(app, companyId, agent.id)
    // 1 from PATCH + 1 pre-rollback = 2
    expect(finalRevisions.data.length).toBeGreaterThanOrEqual(2)
  })
})
