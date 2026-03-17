import { describe, it, expect, vi } from 'vitest'
import { ContextBuilder } from '../src/context-builder.js'
import type { DatabaseProvider, QueryResult } from '@shackleai/db'

/**
 * Creates a mock DatabaseProvider that returns preset rows for known queries.
 */
function createMockDb(overrides: {
  agent?: Record<string, unknown> | null
  company?: Record<string, unknown> | null
  team?: Record<string, unknown>[]
  tasks?: Record<string, unknown>[]
  policies?: Record<string, unknown>[]
  reports?: Record<string, unknown>[]
} = {}): DatabaseProvider {
  const queryFn = vi.fn(async (sql: string): Promise<QueryResult> => {
    const sqlLower = sql.toLowerCase()

    // Order matters: check more specific patterns first
    if (sqlLower.includes('reports_to')) {
      return { rows: overrides.reports ?? [] }
    }

    if (sqlLower.includes('from agents') && sqlLower.includes('id != $2')) {
      return { rows: overrides.team ?? [] }
    }

    if (sqlLower.includes('from agents') && sqlLower.includes('id = $1')) {
      return { rows: overrides.agent ? [overrides.agent] : [] }
    }

    if (sqlLower.includes('from companies')) {
      return { rows: overrides.company ? [overrides.company] : [] }
    }

    if (sqlLower.includes('from issues')) {
      return { rows: overrides.tasks ?? [] }
    }

    if (sqlLower.includes('from policies')) {
      return { rows: overrides.policies ?? [] }
    }

    return { rows: [] }
  })

  return {
    query: queryFn,
    exec: vi.fn(),
    close: vi.fn(),
  }
}

describe('ContextBuilder', () => {
  const AGENT_ID = 'agent-001'
  const COMPANY_ID = 'company-001'

  it('builds context with team, tasks, policies, and reports', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: 'Senior Engineer', capabilities: 'coding', status: 'idle' },
      company: { name: 'Acme Corp', description: 'Build the future' },
      team: [
        { name: 'bob', role: 'researcher', status: 'active' },
        { name: 'carol', role: 'designer', status: 'idle' },
      ],
      tasks: [
        { identifier: 'ACME-42', title: 'Fix login bug', status: 'in_progress', priority: 'high' },
        { identifier: 'ACME-45', title: 'Update docs', status: 'todo', priority: 'medium' },
      ],
      policies: [
        { tool_pattern: 'github.*', action: 'read' },
        { tool_pattern: 'github.*', action: 'write' },
      ],
      reports: [
        { name: 'charlie', role: 'worker' },
      ],
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    // Identity section
    expect(context).toContain('# ShackleAI Agent Context')
    expect(context).toContain('- Name: alice')
    expect(context).toContain('- Role: engineer')
    expect(context).toContain('- Title: Senior Engineer')
    expect(context).toContain('- Company: Acme Corp')
    expect(context).toContain('- Mission: Build the future')

    // Team section
    expect(context).toContain('## Your Team')
    expect(context).toContain('| bob | researcher | active |')
    expect(context).toContain('| carol | designer | idle |')

    // Reports section
    expect(context).toContain('## Your Direct Reports')
    expect(context).toContain('- charlie (worker)')

    // Tasks section
    expect(context).toContain('## Active Tasks')
    expect(context).toContain('- ACME-42: Fix login bug [in_progress, high]')
    expect(context).toContain('- ACME-45: Update docs [todo, medium]')

    // Policies section
    expect(context).toContain('## Governance Policies')
    expect(context).toContain('- github.*: read')
    expect(context).toContain('- github.*: write')

    // API reference section
    expect(context).toContain('## Reporting Results')
    expect(context).toContain('__shackleai_result__')
  })

  it('shows "No active tasks" when agent has no tasks', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: null, capabilities: null, status: 'idle' },
      company: { name: 'Acme Corp', description: null },
      team: [{ name: 'bob', role: 'researcher', status: 'idle' }],
      tasks: [],
      policies: [],
      reports: [],
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('No active tasks.')
  })

  it('shows "No team members" when agent has no team', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: null, capabilities: null, status: 'idle' },
      company: { name: 'Acme Corp', description: null },
      team: [],
      tasks: [],
      policies: [],
      reports: [],
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('No team members.')
  })

  it('includes API reference section in all contexts', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'agent', title: null, capabilities: null, status: 'idle' },
      company: { name: 'Test', description: null },
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('## Reporting Results')
    expect(context).toContain('__shackleai_result__')
    expect(context).toContain('sessionState')
    expect(context).toContain('inputTokens')
  })

  it('handles missing agent gracefully', async () => {
    const db = createMockDb({
      agent: null,
      company: { name: 'Test', description: null },
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('- Name: Unknown')
    expect(context).toContain('- Role: agent')
  })

  it('handles missing company gracefully', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: null, capabilities: null, status: 'idle' },
      company: null,
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('- Company: Unknown')
  })

  it('shows "No direct reports" when agent has no reports', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: null, capabilities: null, status: 'idle' },
      company: { name: 'Test', description: null },
      reports: [],
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('No direct reports.')
  })

  it('shows "No policies configured" when no policies exist', async () => {
    const db = createMockDb({
      agent: { id: AGENT_ID, name: 'alice', role: 'engineer', title: null, capabilities: null, status: 'idle' },
      company: { name: 'Test', description: null },
      policies: [],
    })

    const builder = new ContextBuilder(db)
    const context = await builder.build(AGENT_ID, COMPANY_ID)

    expect(context).toContain('No policies configured.')
  })
})
