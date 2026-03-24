/**
 * Wakeup endpoint integration tests
 * POST /api/companies/:id/agents/:agentId/wakeup
 * NOTE: Process adapter used for non-LLM-preflight tests.
 */

import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { AdapterType, AgentStatus } from '@shackleai/shared'
import type { Scheduler, RunnerResult } from '@shackleai/core'
import { createApp } from '../src/server/index.js'

function uniqueName(base: string) {
  return `${base} ${randomBytes(3).toString('hex')}`
}

async function createCompany(
  app: ReturnType<typeof createApp>,
  name = uniqueName('Wakeup Corp'),
) {
  const prefix = (
    name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) +
    randomBytes(2).toString('hex').toUpperCase()
  ).slice(0, 6)
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, issue_prefix: prefix }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

async function createAgent(app: ReturnType<typeof createApp>, companyId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Wakeup Agent ${randomBytes(2).toString('hex')}`, adapter_type: AdapterType.Process, ...overrides }),
  })
  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}

function wakeup(app: ReturnType<typeof createApp>, companyId: string, agentId: string) {
  return app.request(`/api/companies/${companyId}/agents/${agentId}/wakeup`, { method: 'POST' })
}

function makeScheduler(triggerResult: RunnerResult | null = null, running = false): Scheduler {
  return { triggerNow: vi.fn().mockResolvedValue(triggerResult), isRunning: vi.fn().mockReturnValue(running), scheduleAgent: vi.fn(), unscheduleAgent: vi.fn(), start: vi.fn(), stop: vi.fn() } as unknown as Scheduler
}

describe('wakeup endpoint — no scheduler (fallback)', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>
  let companyId: string
  let agentId: string
  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
    companyId = await createCompany(app)
    agentId = await createAgent(app, companyId)
  })
  afterAll(async () => { await db.close() })

  it('returns 200 for a valid agent', async () => {
    expect((await wakeup(app, companyId, agentId)).status).toBe(200)
  })

  it('response has agent data and triggered=false in fallback mode', async () => {
    const body = (await (await wakeup(app, companyId, agentId)).json()) as { data: { triggered: boolean; agent: { id: string } } }
    expect(body.data.triggered).toBe(false)
    expect(body.data.agent.id).toBe(agentId)
  })

  it('updates last_heartbeat_at on the agent record', async () => {
    const before = Date.now()
    const body = (await (await wakeup(app, companyId, agentId)).json()) as { data: { agent: { last_heartbeat_at: string } } }
    expect(body.data.agent.last_heartbeat_at).toBeTruthy()
    expect(new Date(body.data.agent.last_heartbeat_at).getTime()).toBeGreaterThanOrEqual(before - 2000)
  })

  it('returns 404 for a non-existent agent ID', async () => {
    const res = await wakeup(app, companyId, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    expect((await res.json() as any).error).toBe('Agent not found')
  })

  it('returns 404 when agent belongs to a different company', async () => {
    const res = await wakeup(app, await createCompany(app), agentId)
    expect(res.status).toBe(404)
    expect((await res.json() as any).error).toBe('Agent not found')
  })

  it('waking up a paused agent updates last_heartbeat_at without changing status', async () => {
    await app.request(`/api/companies/${companyId}/agents/${agentId}/pause`, { method: 'POST' })
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { agent: { status: string; last_heartbeat_at: string } } }
    expect(body.data.agent.status).toBe(AgentStatus.Paused)
    expect(body.data.agent.last_heartbeat_at).toBeTruthy()
    await app.request(`/api/companies/${companyId}/agents/${agentId}/resume`, { method: 'POST' })
  })

  it('waking up a terminated agent returns 200 with heartbeat updated', async () => {
    const tId = await createAgent(app, companyId)
    await app.request(`/api/companies/${companyId}/agents/${tId}/terminate`, { method: 'POST' })
    const res = await wakeup(app, companyId, tId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { agent: { status: string; last_heartbeat_at: string } } }
    expect(body.data.agent.status).toBe(AgentStatus.Terminated)
    expect(body.data.agent.last_heartbeat_at).toBeTruthy()
  })
})

describe('wakeup endpoint — with scheduler (triggered path)', () => {
  let db: PGliteProvider
  const successResult: RunnerResult = { exitCode: 0, stdout: 'heartbeat complete', stderr: '' }
  beforeAll(async () => { db = new PGliteProvider(); await runMigrations(db) })
  afterAll(async () => { await db.close() })

  it('returns triggered=true when scheduler fires successfully', async () => {
    const scheduler = makeScheduler(successResult)
    const app = createApp(db, { skipAuth: true, scheduler })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId)
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean; result: { exitCode: number } } }
    expect(body.data.triggered).toBe(true)
    expect(body.data.result.exitCode).toBe(0)
  })

  it('calls scheduler.triggerNow with the correct agentId', async () => {
    const scheduler = makeScheduler(successResult)
    const app = createApp(db, { skipAuth: true, scheduler })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId)
    await wakeup(app, companyId, agentId)
    expect(scheduler.triggerNow).toHaveBeenCalledWith(agentId, expect.any(String))
  })

  it('re-fetches agent after execution to return updated state', async () => {
    const scheduler = makeScheduler(successResult)
    const app = createApp(db, { skipAuth: true, scheduler })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId)
    const body = (await (await wakeup(app, companyId, agentId)).json()) as { data: { agent: { id: string } } }
    expect(body.data.agent.id).toBe(agentId)
  })
})

describe('wakeup endpoint — scheduler coalescing', () => {
  let db: PGliteProvider
  beforeAll(async () => { db = new PGliteProvider(); await runMigrations(db) })
  afterAll(async () => { await db.close() })

  it('returns triggered=false when agent is already running', async () => {
    const scheduler = makeScheduler(null, true)
    const app = createApp(db, { skipAuth: true, scheduler })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId)
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean; reason: string } }
    expect(body.data.triggered).toBe(false)
    expect(body.data.reason).toMatch(/already in progress/i)
  })

  it('returns triggered=false with generic reason when execution could not start', async () => {
    const scheduler = makeScheduler(null, false)
    const app = createApp(db, { skipAuth: true, scheduler })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId)
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { triggered: boolean; reason: string } }
    expect(body.data.triggered).toBe(false)
    expect(body.data.reason).toMatch(/could not be started/i)
  })
})

describe('wakeup endpoint — LLM key pre-flight', () => {
  let db: PGliteProvider
  beforeAll(async () => { db = new PGliteProvider(); await runMigrations(db) })
  afterAll(async () => { await db.close() })
  afterEach(() => { delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY })

  it('returns 400 MISSING_LLM_KEY when CrewAI adapter and OPENAI_API_KEY absent', async () => {
    delete process.env.OPENAI_API_KEY
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler() })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.CrewAI })
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; error: string }
    expect(body.code).toBe('MISSING_LLM_KEY')
    expect(body.error).toMatch(/OpenAI/i)
  })

  it('returns 400 MISSING_LLM_KEY when OpenClaw adapter and OPENAI_API_KEY absent', async () => {
    delete process.env.OPENAI_API_KEY
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler() })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.OpenClaw })
    const res = await wakeup(app, companyId, agentId)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; error: string }
    expect(body.code).toBe('MISSING_LLM_KEY')
    expect(body.error).toMatch(/OpenAI/i)
  })

  it('allows Claude adapter without ANTHROPIC_API_KEY (uses CLI subscription)', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler({ exitCode: 0, stdout: '', stderr: '' }) })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.Claude })
    const res = await wakeup(app, companyId, agentId)
    // Claude adapter no longer requires API key — uses CLI subscription
    expect(res.status).toBe(200)
  })

  it('passes pre-flight when ANTHROPIC_API_KEY present for Claude adapter', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler({ exitCode: 0, stdout: '', stderr: '' }) })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.Claude })
    expect((await wakeup(app, companyId, agentId)).status).toBe(200)
  })

  it('passes pre-flight when OPENAI_API_KEY present for CrewAI adapter', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler({ exitCode: 0, stdout: '', stderr: '' }) })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.CrewAI })
    expect((await wakeup(app, companyId, agentId)).status).toBe(200)
  })

  it('Process adapter bypasses LLM pre-flight regardless of env keys', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const app = createApp(db, { skipAuth: true, scheduler: makeScheduler({ exitCode: 0, stdout: '', stderr: '' }) })
    const companyId = await createCompany(app)
    const agentId = await createAgent(app, companyId, { adapter_type: AdapterType.Process })
    expect((await wakeup(app, companyId, agentId)).status).toBe(200)
  })
})
