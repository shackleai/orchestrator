/**
 * Battle Test — LLM Config (#287)
 *
 * Full coverage of the LLM config CRUD API.
 * Routes: /api/companies/:id/llm-configs[/:configId]
 * Real PGlite database, no mocks.
 *
 * Architecture notes:
 *   - LlmProvider enum: openai, anthropic, google, mistral, groq, ollama, openrouter
 *   - (company_id, provider, model) must be UNIQUE → 409 on duplicate
 *   - is_default: only ONE config per company can be default at a time
 *     Setting a new default unsets the previous one automatically
 *   - DELETE blocked when any agent has llm_config_id pointing at this config → 409
 *   - Validation: provider must be in enum, model must be non-empty
 *   - temperature: 0–2, max_tokens: int ≥ 1
 *
 * Happy Path:
 *   1. Create config → 201 with all fields
 *   2. List configs → 200 with pagination
 *   3. Update config (PUT) — change model name → 200
 *   4. Set default via POST (is_default: true) unsets previous default
 *   5. Set default via PUT unsets previous default
 *   6. Create with optional fields (max_tokens, temperature) → stored correctly
 *   7. Update to set max_tokens and temperature → stored
 *   8. Delete config → 200 { deleted: true }
 *   9. Full CRUD lifecycle: create → list → update → delete
 *  10. PUT with empty body (no fields) → 200, returns unchanged config
 *
 * Edge Cases:
 *  11. Duplicate (provider, model) within same company → 409
 *  12. Same provider/model in different companies → both 201 (no conflict)
 *  13. Invalid provider → 400 with validation error
 *  14. temperature > 2 → 400
 *  15. temperature < 0 → 400
 *  16. max_tokens = 0 → 400 (must be ≥ 1)
 *  17. Empty model string → 400
 *  18. Invalid JSON body → 400
 *  19. Update non-existent config → 404
 *  20. Delete non-existent config → 404
 *  21. Delete when agent references config → 409
 *  22. Detach agent → delete now succeeds
 *
 * Multi-Tenant:
 *  23. Company A configs not visible to company B
 *  24. Company B cannot delete company A config
 *  25. Default management is per-company (A's default doesn't affect B)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type App = ReturnType<typeof createApp>

type CompanyRow = { id: string }

type AgentRow = { id: string; name: string; llm_config_id: string | null }

type LlmConfigRow = {
  id: string
  company_id: string
  provider: string
  model: string
  is_default: boolean
  max_tokens: number | null
  temperature: number | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCompany(app: App, prefix: string): Promise<CompanyRow> {
  const suffix = randomBytes(4).toString('hex')
  const res = await app.request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `LLMBattle-${prefix}-${suffix}`,
      issue_prefix: prefix.slice(0, 4).toUpperCase(),
    }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: CompanyRow }).data
}

async function createConfig(
  app: App,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(`/api/companies/${companyId}/llm-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai',
      model: `gpt-4-${randomBytes(4).toString('hex')}`,
      ...overrides,
    }),
  })
  return { status: res.status, body: await res.json() }
}

async function createAgent(
  app: App,
  companyId: string,
  llmConfigId?: string,
): Promise<AgentRow> {
  const res = await app.request(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `agent-${randomBytes(4).toString('hex')}`,
      adapter_type: 'process',
      ...(llmConfigId ? { llm_config_id: llmConfigId } : {}),
    }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: AgentRow }).data
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: App
let companyA: CompanyRow
let companyB: CompanyRow

beforeAll(async () => {
  const db = new PGliteProvider()
  await runMigrations(db)
  app = createApp(db, { skipAuth: true })
  companyA = await createCompany(app, 'LLMA')
  companyB = await createCompany(app, 'LLMB')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM Config Battle Test (#287)', () => {

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  it('1. create config → 201 with all fields', async () => {
    const { status, body } = await createConfig(app, companyA.id, {
      provider: 'anthropic',
      model: 'claude-3-opus',
      is_default: false,
      max_tokens: 4096,
      temperature: 0.7,
    })

    expect(status).toBe(201)
    const config = (body as { data: LlmConfigRow }).data
    expect(config.company_id).toBe(companyA.id)
    expect(config.provider).toBe('anthropic')
    expect(config.model).toBe('claude-3-opus')
    expect(config.is_default).toBe(false)
    expect(config.max_tokens).toBe(4096)
    // After #310 fix, NUMERIC fields are coerced to numbers in the response
    expect(config.temperature).toBeCloseTo(0.7)
    expect(typeof config.temperature).toBe('number')
    expect(typeof config.id).toBe('string')
    expect(typeof config.created_at).toBe('string')
    expect(typeof config.updated_at).toBe('string')
  })

  it('2. list configs → 200 with correct data', async () => {
    const company = await createCompany(app, 'LIST')
    await createConfig(app, company.id, { provider: 'openai', model: 'gpt-4o' })
    await createConfig(app, company.id, { provider: 'anthropic', model: 'claude-3-haiku' })

    const res = await app.request(`/api/companies/${company.id}/llm-configs`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: LlmConfigRow[] }
    expect(body.data.length).toBe(2)
    // Defaults first (all false here), then by created_at DESC
    expect(body.data.every((c) => c.company_id === company.id)).toBe(true)
  })

  it('3. update config (PUT) — change model name → 200', async () => {
    const { body: createBody } = await createConfig(app, companyA.id, {
      provider: 'google',
      model: 'gemini-pro',
    })
    const config = (createBody as { data: LlmConfigRow }).data

    const res = await app.request(
      `/api/companies/${companyA.id}/llm-configs/${config.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-1.5-pro' }),
      },
    )
    expect(res.status).toBe(200)
    const updated = ((await res.json()) as { data: LlmConfigRow }).data
    expect(updated.model).toBe('gemini-1.5-pro')
    expect(updated.provider).toBe('google')
    expect(updated.id).toBe(config.id)
  })

  it('4. POST with is_default:true unsets the previous default', async () => {
    const company = await createCompany(app, 'DEF1')

    // First config — set as default
    const { body: b1 } = await createConfig(app, company.id, {
      provider: 'openai',
      model: 'gpt-4o-first',
      is_default: true,
    })
    const first = (b1 as { data: LlmConfigRow }).data
    expect(first.is_default).toBe(true)

    // Second config — also set as default
    const { body: b2 } = await createConfig(app, company.id, {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      is_default: true,
    })
    const second = (b2 as { data: LlmConfigRow }).data
    expect(second.is_default).toBe(true)

    // Verify first is no longer default
    const listRes = await app.request(`/api/companies/${company.id}/llm-configs`)
    const list = ((await listRes.json()) as { data: LlmConfigRow[] }).data
    const firstInList = list.find((c) => c.id === first.id)!
    const secondInList = list.find((c) => c.id === second.id)!
    expect(firstInList.is_default).toBe(false)
    expect(secondInList.is_default).toBe(true)
  })

  it('5. PUT with is_default:true unsets previous default', async () => {
    const company = await createCompany(app, 'DEF2')

    const { body: b1 } = await createConfig(app, company.id, {
      provider: 'groq',
      model: 'llama-3.1-8b',
      is_default: true,
    })
    const first = (b1 as { data: LlmConfigRow }).data

    const { body: b2 } = await createConfig(app, company.id, {
      provider: 'mistral',
      model: 'mistral-small',
      is_default: false,
    })
    const second = (b2 as { data: LlmConfigRow }).data

    // Promote second to default via PUT
    const res = await app.request(
      `/api/companies/${company.id}/llm-configs/${second.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      },
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: LlmConfigRow }).data.is_default).toBe(true)

    // First should now be non-default
    const listRes = await app.request(`/api/companies/${company.id}/llm-configs`)
    const list = ((await listRes.json()) as { data: LlmConfigRow[] }).data
    expect(list.find((c) => c.id === first.id)!.is_default).toBe(false)
  })

  it('6. create with optional fields null — stored as null', async () => {
    const company = await createCompany(app, 'OPT1')
    const { status, body } = await createConfig(app, company.id, {
      provider: 'ollama',
      model: 'llama3',
      max_tokens: null,
      temperature: null,
    })
    expect(status).toBe(201)
    const config = (body as { data: LlmConfigRow }).data
    expect(config.max_tokens).toBeNull()
    expect(config.temperature).toBeNull()
  })

  it('7. update max_tokens and temperature → stored correctly', async () => {
    const company = await createCompany(app, 'UPD1')
    const { body: cb } = await createConfig(app, company.id)
    const config = (cb as { data: LlmConfigRow }).data

    const res = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_tokens: 8192, temperature: 1.5 }),
      },
    )
    expect(res.status).toBe(200)
    const updated = ((await res.json()) as { data: LlmConfigRow }).data
    expect(updated.max_tokens).toBe(8192)
    expect(updated.temperature).toBeCloseTo(1.5)
    expect(typeof updated.temperature).toBe('number')
  })

  it('8. delete config → 200 { deleted: true }', async () => {
    const company = await createCompany(app, 'DEL3')
    const { body } = await createConfig(app, company.id)
    const config = (body as { data: LlmConfigRow }).data

    const res = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const deleteBody = (await res.json()) as { data: { deleted: boolean; id: string } }
    expect(deleteBody.data.deleted).toBe(true)
    expect(deleteBody.data.id).toBe(config.id)
  })

  it('9. full CRUD lifecycle', async () => {
    const company = await createCompany(app, 'CRUD')

    // Create
    const { status: s1, body: b1 } = await createConfig(app, company.id, {
      provider: 'openrouter',
      model: 'mixtral-8x7b',
      is_default: true,
      max_tokens: 2048,
      temperature: 0.5,
    })
    expect(s1).toBe(201)
    const config = (b1 as { data: LlmConfigRow }).data
    expect(config.is_default).toBe(true)

    // List
    const listRes = await app.request(`/api/companies/${company.id}/llm-configs`)
    const list = ((await listRes.json()) as { data: LlmConfigRow[] }).data
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(config.id)

    // Update
    const updateRes = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mixtral-8x22b', temperature: 0.9 }),
      },
    )
    expect(updateRes.status).toBe(200)
    const updated = ((await updateRes.json()) as { data: LlmConfigRow }).data
    expect(updated.model).toBe('mixtral-8x22b')

    // Delete
    const deleteRes = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)

    // List is empty
    const listRes2 = await app.request(`/api/companies/${company.id}/llm-configs`)
    const list2 = ((await listRes2.json()) as { data: LlmConfigRow[] }).data
    expect(list2.length).toBe(0)
  })

  it('10. PUT with empty body returns unchanged config (no-op)', async () => {
    const company = await createCompany(app, 'NOOP')
    const { body } = await createConfig(app, company.id, {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
    })
    const config = (body as { data: LlmConfigRow }).data

    const res = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(res.status).toBe(200)
    const unchanged = ((await res.json()) as { data: LlmConfigRow }).data
    expect(unchanged.model).toBe('gpt-3.5-turbo')
    expect(unchanged.temperature).toBeCloseTo(0.3)
    expect(typeof unchanged.temperature).toBe('number')
  })

  // -------------------------------------------------------------------------
  // Edge / Error Cases
  // -------------------------------------------------------------------------

  it('11. duplicate (provider, model) within same company → 409', async () => {
    const company = await createCompany(app, 'DUP1')
    const model = `gpt-4-dup-${randomBytes(4).toString('hex')}`

    const { status: s1 } = await createConfig(app, company.id, {
      provider: 'openai',
      model,
    })
    expect(s1).toBe(201)

    const { status: s2, body } = await createConfig(app, company.id, {
      provider: 'openai',
      model, // exact duplicate
    })
    expect(s2).toBe(409)
    expect((body as { error: string }).error).toContain('already exists')
  })

  it('12. same provider/model in different companies → both 201', async () => {
    const company1 = await createCompany(app, 'MT1')
    const company2 = await createCompany(app, 'MT2')
    const model = `shared-model-${randomBytes(4).toString('hex')}`

    const { status: s1 } = await createConfig(app, company1.id, {
      provider: 'anthropic',
      model,
    })
    expect(s1).toBe(201)

    const { status: s2 } = await createConfig(app, company2.id, {
      provider: 'anthropic',
      model,
    })
    expect(s2).toBe(201)
  })

  it('13. invalid provider → 400 validation error', async () => {
    const { status, body } = await createConfig(app, companyA.id, {
      provider: 'invalid-llm-provider',
      model: 'some-model',
    })
    expect(status).toBe(400)
    expect((body as { error: string }).error).toContain('Validation failed')
  })

  it('14. temperature > 2 → 400', async () => {
    const { status } = await createConfig(app, companyA.id, {
      provider: 'openai',
      model: `gpt-temp-high-${randomBytes(4).toString('hex')}`,
      temperature: 2.1,
    })
    expect(status).toBe(400)
  })

  it('15. temperature < 0 → 400', async () => {
    const { status } = await createConfig(app, companyA.id, {
      provider: 'openai',
      model: `gpt-temp-neg-${randomBytes(4).toString('hex')}`,
      temperature: -0.1,
    })
    expect(status).toBe(400)
  })

  it('16. max_tokens = 0 → 400 (must be ≥ 1)', async () => {
    const { status } = await createConfig(app, companyA.id, {
      provider: 'openai',
      model: `gpt-tokens-zero-${randomBytes(4).toString('hex')}`,
      max_tokens: 0,
    })
    expect(status).toBe(400)
  })

  it('17. empty model string → 400', async () => {
    const res = await app.request(`/api/companies/${companyA.id}/llm-configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('18. invalid JSON body → 400', async () => {
    const res = await app.request(`/api/companies/${companyA.id}/llm-configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    })
    expect(res.status).toBe(400)
  })

  it('19. update non-existent config → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyA.id}/llm-configs/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('20. delete non-existent config → 404', async () => {
    const res = await app.request(
      `/api/companies/${companyA.id}/llm-configs/00000000-0000-0000-0000-000000000000`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  it('21. delete config referenced by an agent → 409', async () => {
    const company = await createCompany(app, 'REF1')
    const { body: cb } = await createConfig(app, company.id, {
      provider: 'openai',
      model: 'gpt-4-referenced',
    })
    const config = (cb as { data: LlmConfigRow }).data

    // Create agent without llm_config_id (POST route does not accept it)
    // then PATCH to assign the config (PATCH route supports llm_config_id via UpdateAgentInput)
    const agent = await createAgent(app, company.id)
    const assignRes = await app.request(
      `/api/companies/${company.id}/agents/${agent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_config_id: config.id }),
      },
    )
    expect(assignRes.status).toBe(200)

    // Attempt delete — should be blocked because the agent references this config
    const res = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain('agents')
  })

  it('22. detach agent → delete succeeds', async () => {
    const company = await createCompany(app, 'DET1')
    const { body: cb } = await createConfig(app, company.id, {
      provider: 'groq',
      model: 'mixtral-detach',
    })
    const config = (cb as { data: LlmConfigRow }).data

    // Create agent and assign the config via PATCH
    const agent = await createAgent(app, company.id)
    const assignRes = await app.request(
      `/api/companies/${company.id}/agents/${agent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_config_id: config.id }),
      },
    )
    expect(assignRes.status).toBe(200)

    // Detach by setting llm_config_id to null
    const patchRes = await app.request(
      `/api/companies/${company.id}/agents/${agent.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm_config_id: null }),
      },
    )
    expect(patchRes.status).toBe(200)

    // Now delete should succeed
    const deleteRes = await app.request(
      `/api/companies/${company.id}/llm-configs/${config.id}`,
      { method: 'DELETE' },
    )
    expect(deleteRes.status).toBe(200)
  })

  // -------------------------------------------------------------------------
  // Multi-Tenant
  // -------------------------------------------------------------------------

  it('23. company A configs not visible to company B', async () => {
    const company1 = await createCompany(app, 'VIS1')
    const company2 = await createCompany(app, 'VIS2')

    await createConfig(app, company1.id, { provider: 'openai', model: 'gpt-4-visible-test' })

    const listRes = await app.request(`/api/companies/${company2.id}/llm-configs`)
    const list = ((await listRes.json()) as { data: LlmConfigRow[] }).data
    expect(list.every((c) => c.company_id === company2.id)).toBe(true)
    expect(list.some((c) => c.company_id === company1.id)).toBe(false)
  })

  it('24. company B cannot delete company A config', async () => {
    const company1 = await createCompany(app, 'DEL4')
    const company2 = await createCompany(app, 'DEL5')

    const { body } = await createConfig(app, company1.id, {
      provider: 'anthropic',
      model: 'claude-3-protected',
    })
    const config = (body as { data: LlmConfigRow }).data

    // Company B attempts delete using company A's config ID
    const res = await app.request(
      `/api/companies/${company2.id}/llm-configs/${config.id}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  })

  it('25. default management is per-company — A default does not affect B', async () => {
    const company1 = await createCompany(app, 'DEF5')
    const company2 = await createCompany(app, 'DEF6')

    // Company 1: set a default
    await createConfig(app, company1.id, {
      provider: 'openai',
      model: 'gpt-4-default-a',
      is_default: true,
    })

    // Company 2: set a different default
    const { body: cb2 } = await createConfig(app, company2.id, {
      provider: 'anthropic',
      model: 'claude-haiku-default-b',
      is_default: true,
    })
    const config2 = (cb2 as { data: LlmConfigRow }).data
    expect(config2.is_default).toBe(true)

    // Company 1 still has its own default unchanged
    const list1 = ((await (await app.request(`/api/companies/${company1.id}/llm-configs`)).json()) as { data: LlmConfigRow[] }).data
    expect(list1.some((c) => c.is_default && c.provider === 'openai')).toBe(true)
  })
})
