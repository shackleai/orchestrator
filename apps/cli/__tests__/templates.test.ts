import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { createApp } from '../src/server/index.js'
import type { Company, Agent, Goal, Policy, CompanyTemplate, TemplateSummary } from '@shackleai/shared'

interface ApiResponse<T> {
  data: T
  error?: string
}

describe('template routes', () => {
  let db: PGliteProvider
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    app = createApp(db, { skipAuth: true })
  })

  afterAll(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // GET /api/templates
  // -------------------------------------------------------------------------

  it('GET /api/templates returns built-in templates', async () => {
    const res = await app.request('/api/templates')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApiResponse<TemplateSummary[]>
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(2)

    const slugs = body.data.map((t) => t.slug)
    expect(slugs).toContain('software-team')
    expect(slugs).toContain('startup')
  })

  it('GET /api/templates lists template metadata', async () => {
    const res = await app.request('/api/templates')
    const body = (await res.json()) as ApiResponse<TemplateSummary[]>

    const swTeam = body.data.find((t) => t.slug === 'software-team')
    expect(swTeam).toBeDefined()
    expect(swTeam!.name).toBe('Software Team')
    expect(swTeam!.agent_count).toBe(4)
    expect(swTeam!.goal_count).toBe(2)
    expect(swTeam!.policy_count).toBe(2)
  })

  // -------------------------------------------------------------------------
  // GET /api/templates/:slug
  // -------------------------------------------------------------------------

  it('GET /api/templates/:slug returns a specific template', async () => {
    const res = await app.request('/api/templates/startup')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApiResponse<CompanyTemplate>
    expect(body.data.name).toBe('Startup')
    expect(body.data.agents).toHaveLength(3)
  })

  it('GET /api/templates/:slug returns 404 for unknown slug', async () => {
    const res = await app.request('/api/templates/nonexistent')
    expect(res.status).toBe(404)
  })

  // -------------------------------------------------------------------------
  // POST /api/companies/:id/import-template — by slug
  // -------------------------------------------------------------------------

  it('POST import-template creates agents, goals, policies from built-in slug', async () => {
    // Create a company first
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Template Test Co', issue_prefix: 'TTC' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    // Import the software-team template
    const importRes = await app.request(
      `/api/companies/${company.id}/import-template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'software-team' }),
      },
    )
    expect(importRes.status).toBe(201)

    const importBody = (await importRes.json()) as ApiResponse<{
      agents_created: number
      goals_created: number
      policies_created: number
      agents: Agent[]
      goals: Goal[]
      policies: Policy[]
    }>

    expect(importBody.data.agents_created).toBe(4)
    expect(importBody.data.goals_created).toBe(2)
    expect(importBody.data.policies_created).toBe(2)

    // Verify agents were actually created in the DB
    const agentsRes = await app.request(`/api/companies/${company.id}/agents`)
    const agentsBody = (await agentsRes.json()) as ApiResponse<Agent[]>
    expect(agentsBody.data).toHaveLength(4)

    // Verify reports_to was resolved correctly
    const pm = agentsBody.data.find((a) => a.name === 'Product Manager')
    const fe = agentsBody.data.find((a) => a.name === 'Frontend Engineer')
    expect(pm).toBeDefined()
    expect(fe).toBeDefined()
    expect(fe!.reports_to).toBe(pm!.id)
  })

  it('POST import-template returns 404 for unknown slug', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Slug404 Co', issue_prefix: 'S4C' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    const importRes = await app.request(
      `/api/companies/${company.id}/import-template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'nonexistent-template' }),
      },
    )
    expect(importRes.status).toBe(404)
  })

  // -------------------------------------------------------------------------
  // POST /api/companies/:id/import-template — inline JSON
  // -------------------------------------------------------------------------

  it('POST import-template accepts inline template JSON', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Inline Co', issue_prefix: 'INL' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    const inlineTemplate = {
      name: 'Custom Team',
      description: 'A custom two-agent team',
      version: '1.0.0',
      agents: [
        {
          name: 'Lead',
          role: 'manager',
          adapter_type: 'process',
        },
        {
          name: 'Dev',
          role: 'worker',
          adapter_type: 'process',
          reports_to: 'Lead',
        },
      ],
      goals: [
        {
          title: 'Ship the product',
          level: 'strategic',
          owner_agent_name: 'Lead',
        },
      ],
      policies: [],
    }

    const importRes = await app.request(
      `/api/companies/${company.id}/import-template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inlineTemplate),
      },
    )
    expect(importRes.status).toBe(201)

    const body = (await importRes.json()) as ApiResponse<{
      agents_created: number
      goals_created: number
      agents: Agent[]
      goals: Goal[]
    }>
    expect(body.data.agents_created).toBe(2)
    expect(body.data.goals_created).toBe(1)

    // Verify reports_to resolved
    const lead = body.data.agents.find((a) => a.name === 'Lead')
    const dev = body.data.agents.find((a) => a.name === 'Dev')
    expect(dev!.reports_to).toBe(lead!.id)

    // Verify goal owner resolved
    expect(body.data.goals[0].owner_agent_id).toBe(lead!.id)
  })

  it('POST import-template returns 400 for invalid template', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Template Co', issue_prefix: 'BTC' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    const importRes = await app.request(
      `/api/companies/${company.id}/import-template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing agents', version: '1.0.0' }),
      },
    )
    expect(importRes.status).toBe(400)
  })

  // -------------------------------------------------------------------------
  // POST /api/companies/:id/export-template
  // -------------------------------------------------------------------------

  it('POST export-template exports company as ID-free template', async () => {
    // Create a company with some agents
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Export Co', issue_prefix: 'EXP' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    // Import a template so we have data to export
    await app.request(`/api/companies/${company.id}/import-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'startup' }),
    })

    // Export it
    const exportRes = await app.request(
      `/api/companies/${company.id}/export-template`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Exported Template',
          description: 'Exported from Export Co',
        }),
      },
    )
    expect(exportRes.status).toBe(200)

    const body = (await exportRes.json()) as ApiResponse<CompanyTemplate>
    const tmpl = body.data

    expect(tmpl.name).toBe('My Exported Template')
    expect(tmpl.description).toBe('Exported from Export Co')
    expect(tmpl.agents).toHaveLength(3)
    expect(tmpl.goals).toHaveLength(2)
    expect(tmpl.policies).toHaveLength(2)

    // Verify IDs are scrubbed — reports_to should be a name, not a UUID
    const cto = tmpl.agents.find((a) => a.name === 'CTO')
    expect(cto).toBeDefined()
    expect(cto!.reports_to).toBe('CEO')

    // Verify goal owner is a name
    const goal = tmpl.goals!.find((g) => g.title === 'Achieve product-market fit')
    expect(goal).toBeDefined()
    expect(goal!.owner_agent_name).toBe('CEO')
  })

  it('POST export-template uses company name as default template name', async () => {
    const createRes = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Default Name Co', issue_prefix: 'DNC' }),
    })
    const company = ((await createRes.json()) as ApiResponse<Company>).data

    // Export without specifying name
    const exportRes = await app.request(
      `/api/companies/${company.id}/export-template`,
      { method: 'POST' },
    )
    expect(exportRes.status).toBe(200)

    const body = (await exportRes.json()) as ApiResponse<CompanyTemplate>
    expect(body.data.name).toBe('Default Name Co')
  })
})
