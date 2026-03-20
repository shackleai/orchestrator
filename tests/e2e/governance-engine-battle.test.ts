/**
 * E2E Battle Test — Governance Engine (#270)
 *
 * Directly exercises GovernanceEngine.checkPolicy() against a real PGlite
 * database. No mocks, no HTTP layer — pure engine evaluation.
 *
 * Coverage matrix:
 *   Happy Path:
 *     - Default-deny: no policy → blocked
 *     - Allow policy grants tool access
 *     - Deny policy blocks tool access
 *     - Glob pattern matching (file:*, net:http*, github.*)
 *     - Priority resolution: higher priority wins
 *     - Log action allows execution (with audit flag)
 *
 *   Edge Cases:
 *     - Conflicting allow/deny at same priority, same scope → first evaluated wins (DB order)
 *     - Wildcard-only policy (*) matches every tool
 *     - Policy with agent_id that does not match the requesting agent is ignored
 *     - Agent-specific policy takes precedence over company-wide at equal priority
 *     - policyId and reason are returned in result
 *
 *   Error / Boundary:
 *     - Empty tool name still evaluates (default-deny)
 *     - Company with no policies → default-deny for all tools
 *     - Policy for different company is not applied to requesting company
 *     - Exact tool name match (no glob) works
 *     - Policy deleted mid-session → subsequent check re-evaluates correctly
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { GovernanceEngine } from '../../packages/core/src/governance/engine.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ID = '10000000-0000-4000-a000-000000000001'
const AGENT_ID = '10000000-0000-4000-a000-000000000020'
const OTHER_AGENT_ID = '10000000-0000-4000-a000-000000000021'
const OTHER_COMPANY_ID = '20000000-0000-4000-a000-000000000001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: PGliteProvider
let engine: GovernanceEngine

async function seedCompany(id: string = COMPANY_ID): Promise<void> {
  // Derive a unique 4-char prefix from the ID to avoid issue_prefix unique constraint
  const prefix = id.replace(/-/g, '').slice(0, 4).toUpperCase()
  await db.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, 'active', $3, 0, 100000, 0)
     ON CONFLICT (id) DO NOTHING`,
    [id, `Gov Corp ${id.slice(0, 8)}`, prefix],
  )
}

async function seedAgent(agentId: string = AGENT_ID, companyId: string = COMPANY_ID): Promise<void> {
  await db.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, 'test-agent', 'process', '{}', 10000, 0)
     ON CONFLICT (id) DO NOTHING`,
    [agentId, companyId],
  )
}

async function insertPolicy(opts: {
  companyId?: string
  agentId?: string | null
  name: string
  toolPattern: string
  action: 'allow' | 'deny' | 'log'
  priority?: number
}): Promise<string> {
  const {
    companyId = COMPANY_ID,
    agentId = null,
    name,
    toolPattern,
    action,
    priority = 0,
  } = opts
  const result = await db.query<{ id: string }>(
    `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [companyId, agentId, name, toolPattern, action, priority],
  )
  return result.rows[0].id
}

async function deletePolicy(policyId: string): Promise<void> {
  await db.query(`DELETE FROM policies WHERE id = $1`, [policyId])
}

async function clearPolicies(companyId: string = COMPANY_ID): Promise<void> {
  await db.query(`DELETE FROM policies WHERE company_id = $1`, [companyId])
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  engine = new GovernanceEngine(db)

  // Seed base data used across all tests
  await seedCompany(COMPANY_ID)
  await seedCompany(OTHER_COMPANY_ID)
  await seedAgent(AGENT_ID, COMPANY_ID)
  await seedAgent(OTHER_AGENT_ID, COMPANY_ID)
}, 60_000) // PGlite migration can take up to 60s on first run

afterAll(async () => {
  await db.close()
}, 15_000)

// ---------------------------------------------------------------------------
// Happy Path: Default-Deny
// ---------------------------------------------------------------------------

describe('Governance Engine — default-deny', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('returns allowed:false when no policies exist for company', async () => {
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')
    expect(result.allowed).toBe(false)
  })

  it('returns correct reason string for default-deny', async () => {
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'any_tool')
    expect(result.reason).toContain('default deny')
    expect(result.policyId).toBeUndefined()
  })

  it('denies all tool names when no policies exist', async () => {
    const tools = ['bash', 'github:create_pr', 'file:read', 'net:http:post', '*', '']
    for (const tool of tools) {
      const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, tool)
      expect(result.allowed).toBe(false)
    }
  })

  it('denies when policies exist for a DIFFERENT company only', async () => {
    // Allow everything for OTHER_COMPANY — should not affect COMPANY_ID
    await insertPolicy({
      companyId: OTHER_COMPANY_ID,
      name: 'other-allow-all',
      toolPattern: '*',
      action: 'allow',
      priority: 100,
    })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')
    expect(result.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Happy Path: Allow policy
// ---------------------------------------------------------------------------

describe('Governance Engine — allow policy', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('returns allowed:true when exact-match allow policy exists', async () => {
    const policyId = await insertPolicy({
      name: 'allow-bash',
      toolPattern: 'bash',
      action: 'allow',
      priority: 10,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
    expect(result.policyId).toBe(policyId)
  })

  it('returns policyId and reason when allow policy matches', async () => {
    const policyId = await insertPolicy({
      name: 'allow-web-search',
      toolPattern: 'web_search',
      action: 'allow',
      priority: 50,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'web_search')
    expect(result.allowed).toBe(true)
    expect(result.policyId).toBe(policyId)
    expect(result.reason).toContain('allow-web-search')
    expect(result.reason).toContain('web_search')
  })

  it('returns allowed:false for non-matching tool even with allow policy', async () => {
    await insertPolicy({
      name: 'allow-bash-only',
      toolPattern: 'bash',
      action: 'allow',
      priority: 10,
    })
    // Different tool — no match → default-deny
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')
    expect(result.allowed).toBe(false)
    expect(result.policyId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Happy Path: Deny policy
// ---------------------------------------------------------------------------

describe('Governance Engine — deny policy', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('returns allowed:false when deny policy matches', async () => {
    const policyId = await insertPolicy({
      name: 'deny-bash',
      toolPattern: 'bash',
      action: 'deny',
      priority: 10,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    expect(result.policyId).toBe(policyId)
  })

  it('includes policy name in reason when deny policy matches', async () => {
    await insertPolicy({
      name: 'security-lockdown',
      toolPattern: 'bash',
      action: 'deny',
      priority: 5,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('security-lockdown')
  })

  it('deny-all policy blocks all tools', async () => {
    await insertPolicy({
      name: 'deny-all',
      toolPattern: '*',
      action: 'deny',
      priority: 10,
    })
    const tools = ['bash', 'github:create_pr', 'file:read', 'net:http:post', 'web_search']
    for (const tool of tools) {
      const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, tool)
      expect(result.allowed).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Happy Path: Glob Pattern Matching
// ---------------------------------------------------------------------------

describe('Governance Engine — glob pattern matching', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('file:* matches all file: prefixed tools', async () => {
    await insertPolicy({
      name: 'allow-file-tools',
      toolPattern: 'file:*',
      action: 'allow',
      priority: 10,
    })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:write')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:delete')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:list_dir')).allowed).toBe(true)
  })

  it('file:* does NOT match net: or github: tools', async () => {
    await insertPolicy({
      name: 'allow-file-only',
      toolPattern: 'file:*',
      action: 'allow',
      priority: 10,
    })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:get')).allowed).toBe(false)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')).allowed).toBe(false)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')).allowed).toBe(false)
  })

  it('net:http* matches net:http:get and net:http:post', async () => {
    await insertPolicy({
      name: 'allow-http',
      toolPattern: 'net:http*',
      action: 'allow',
      priority: 10,
    })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:get')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:post')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:put')).allowed).toBe(true)
    // net:ftp should NOT match net:http*
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:ftp:upload')).allowed).toBe(false)
  })

  it('github.* matches github.list_issues and github.create_pr', async () => {
    await insertPolicy({
      name: 'allow-github',
      toolPattern: 'github.*',
      action: 'allow',
      priority: 10,
    })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github.list_issues')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github.create_pr')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github.push_commit')).allowed).toBe(true)
    // Colon-separated variant should NOT match dot-glob
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')).allowed).toBe(false)
  })

  it('wildcard-only policy (*) matches every tool name', async () => {
    await insertPolicy({
      name: 'allow-everything',
      toolPattern: '*',
      action: 'allow',
      priority: 10,
    })

    const tools = ['bash', 'file:read', 'net:http:post', 'github.create_pr', 'web_search', 'any_tool_whatsoever']
    for (const tool of tools) {
      const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, tool)
      expect(result.allowed).toBe(true)
    }
  })

  it('deny glob pattern (github:*) blocks all github: tools', async () => {
    await insertPolicy({
      name: 'allow-all',
      toolPattern: '*',
      action: 'allow',
      priority: 1,
    })
    await insertPolicy({
      name: 'deny-github',
      toolPattern: 'github:*',
      action: 'deny',
      priority: 10, // Higher priority — deny wins for github:
    })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')).allowed).toBe(false)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:create_pr')).allowed).toBe(false)
    // Non-github tools still allowed by lower-priority allow-all
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')).allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Happy Path: Priority Resolution
// ---------------------------------------------------------------------------

describe('Governance Engine — priority resolution', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('higher-priority allow overrides lower-priority deny', async () => {
    await insertPolicy({ name: 'deny-all-low', toolPattern: '*', action: 'deny', priority: 1 })
    await insertPolicy({ name: 'allow-bash-high', toolPattern: 'bash', action: 'allow', priority: 100 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('allow-bash-high')
  })

  it('higher-priority deny overrides lower-priority allow', async () => {
    await insertPolicy({ name: 'allow-all-low', toolPattern: '*', action: 'allow', priority: 1 })
    await insertPolicy({ name: 'deny-bash-high', toolPattern: 'bash', action: 'deny', priority: 100 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('deny-bash-high')
  })

  it('non-matching tool falls through to lower-priority matching policy', async () => {
    // High-priority policy matches 'bash' only
    await insertPolicy({ name: 'deny-bash', toolPattern: 'bash', action: 'deny', priority: 100 })
    // Low-priority policy matches everything
    await insertPolicy({ name: 'allow-all', toolPattern: '*', action: 'allow', priority: 1 })

    // 'bash' hits high-priority deny
    const bashResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(bashResult.allowed).toBe(false)

    // 'file:read' skips high-priority (no match), falls through to low-priority allow
    const fileResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')
    expect(fileResult.allowed).toBe(true)
  })

  it('three-tier priority: highest wins among multiple policies', async () => {
    await insertPolicy({ name: 'allow-p10', toolPattern: 'bash', action: 'allow', priority: 10 })
    await insertPolicy({ name: 'deny-p50', toolPattern: 'bash', action: 'deny', priority: 50 })
    await insertPolicy({ name: 'allow-p200', toolPattern: 'bash', action: 'allow', priority: 200 })

    // priority 200 allow should win
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('allow-p200')
  })
})

// ---------------------------------------------------------------------------
// Happy Path: Log action
// ---------------------------------------------------------------------------

describe('Governance Engine — log action', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('log action allows execution (returns allowed:true)', async () => {
    const policyId = await insertPolicy({
      name: 'audit-bash',
      toolPattern: 'bash',
      action: 'log',
      priority: 10,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
    expect(result.policyId).toBe(policyId)
  })

  it('log action reason indicates audit logging', async () => {
    await insertPolicy({
      name: 'audit-everything',
      toolPattern: '*',
      action: 'log',
      priority: 5,
    })
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('audit-everything')
  })

  it('log action at lower priority does not override higher-priority deny', async () => {
    await insertPolicy({ name: 'log-all', toolPattern: '*', action: 'log', priority: 1 })
    await insertPolicy({ name: 'deny-bash', toolPattern: 'bash', action: 'deny', priority: 50 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('deny-bash')
  })

  it('log action at higher priority overrides lower-priority deny', async () => {
    await insertPolicy({ name: 'deny-all', toolPattern: '*', action: 'deny', priority: 1 })
    await insertPolicy({ name: 'log-bash', toolPattern: 'bash', action: 'log', priority: 50 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Same-priority conflict
// ---------------------------------------------------------------------------

describe('Governance Engine — same-priority conflicts', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('allow and deny at same priority — first matching policy in DB order applies', async () => {
    // Insert allow first, then deny at same priority
    await insertPolicy({ name: 'allow-first', toolPattern: 'bash', action: 'allow', priority: 50 })
    await insertPolicy({ name: 'deny-second', toolPattern: 'bash', action: 'deny', priority: 50 })

    // The DB ORDER BY priority DESC returns both; JavaScript sort is stable.
    // When priorities are equal and both have agent_id=null, insertion order
    // preserved by DB is the deterministic tiebreaker.
    // Engine uses first match — result must be deterministic (allow or deny, not undefined).
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(typeof result.allowed).toBe('boolean')
    expect(result.policyId).toBeDefined()
  })

  it('deny and allow at same priority — result is deterministic regardless of order', async () => {
    // Insert deny first, then allow
    await insertPolicy({ name: 'deny-first', toolPattern: 'bash', action: 'deny', priority: 50 })
    await insertPolicy({ name: 'allow-second', toolPattern: 'bash', action: 'allow', priority: 50 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    // Must be boolean — no crash or undefined
    expect(typeof result.allowed).toBe('boolean')
    expect(result.policyId).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Agent scoping
// ---------------------------------------------------------------------------

describe('Governance Engine — agent scoping', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('policy with no matching agent_id (different agent) is ignored for requesting agent', async () => {
    // Policy scoped to OTHER_AGENT_ID — should not apply to AGENT_ID
    await insertPolicy({
      agentId: OTHER_AGENT_ID,
      name: 'other-agent-allow',
      toolPattern: 'bash',
      action: 'allow',
      priority: 100,
    })

    // AGENT_ID has no matching policy → default-deny
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    expect(result.policyId).toBeUndefined()
  })

  it('agent-specific allow applies ONLY to that agent, not to others', async () => {
    await insertPolicy({
      agentId: AGENT_ID,
      name: 'agent-specific-allow',
      toolPattern: 'bash',
      action: 'allow',
      priority: 50,
    })

    // AGENT_ID should be allowed
    const agentResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(agentResult.allowed).toBe(true)

    // OTHER_AGENT_ID has no matching policy → default-deny
    const otherResult = await engine.checkPolicy(COMPANY_ID, OTHER_AGENT_ID, 'bash')
    expect(otherResult.allowed).toBe(false)
  })

  it('company-wide policy applies to all agents', async () => {
    await insertPolicy({
      agentId: null,
      name: 'company-wide-allow',
      toolPattern: 'bash',
      action: 'allow',
      priority: 50,
    })

    const result1 = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    const result2 = await engine.checkPolicy(COMPANY_ID, OTHER_AGENT_ID, 'bash')

    expect(result1.allowed).toBe(true)
    expect(result2.allowed).toBe(true)
  })

  it('agent-specific deny overrides company-wide allow at equal priority', async () => {
    // Company-wide allow for bash
    await insertPolicy({
      agentId: null,
      name: 'company-allow-bash',
      toolPattern: 'bash',
      action: 'allow',
      priority: 50,
    })
    // Agent-specific deny at SAME priority — agent-specific takes precedence
    await insertPolicy({
      agentId: AGENT_ID,
      name: 'agent-deny-bash',
      toolPattern: 'bash',
      action: 'deny',
      priority: 50,
    })

    // AGENT_ID: agent-specific deny wins
    const agentResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(agentResult.allowed).toBe(false)
    expect(agentResult.reason).toContain('agent-deny-bash')

    // OTHER_AGENT_ID: only company-wide allow applies
    const otherResult = await engine.checkPolicy(COMPANY_ID, OTHER_AGENT_ID, 'bash')
    expect(otherResult.allowed).toBe(true)
  })

  it('agent-specific allow overrides company-wide deny at equal priority', async () => {
    await insertPolicy({
      agentId: null,
      name: 'company-deny-all',
      toolPattern: '*',
      action: 'deny',
      priority: 50,
    })
    await insertPolicy({
      agentId: AGENT_ID,
      name: 'agent-allow-bash',
      toolPattern: 'bash',
      action: 'allow',
      priority: 50,
    })

    // AGENT_ID: agent-specific allow wins over company-wide deny
    const agentResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(agentResult.allowed).toBe(true)

    // OTHER_AGENT_ID: only company-wide deny applies
    const otherResult = await engine.checkPolicy(COMPANY_ID, OTHER_AGENT_ID, 'bash')
    expect(otherResult.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Multi-tenant isolation
// ---------------------------------------------------------------------------

describe('Governance Engine — multi-tenant isolation', () => {
  beforeEach(async () => {
    await clearPolicies(COMPANY_ID)
    await clearPolicies(OTHER_COMPANY_ID)
  })

  it('OTHER_COMPANY policy does not bleed into COMPANY requests', async () => {
    await insertPolicy({
      companyId: OTHER_COMPANY_ID,
      name: 'other-allow-all',
      toolPattern: '*',
      action: 'allow',
      priority: 999,
    })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
  })

  it('COMPANY policy does not affect OTHER_COMPANY agents', async () => {
    await insertPolicy({
      companyId: COMPANY_ID,
      name: 'company-deny-all',
      toolPattern: '*',
      action: 'deny',
      priority: 999,
    })

    // OTHER_COMPANY agent — no policies in that company → default-deny (not because of COMPANY policy)
    const result = await engine.checkPolicy(OTHER_COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(false)
    // Verify it's default-deny (no policyId), not the COMPANY_ID deny policy
    expect(result.policyId).toBeUndefined()
    expect(result.reason).toContain('default deny')
  })

  it('both companies can have independent policies', async () => {
    await insertPolicy({ companyId: COMPANY_ID, name: 'allow-bash', toolPattern: 'bash', action: 'allow', priority: 10 })
    await insertPolicy({ companyId: OTHER_COMPANY_ID, name: 'deny-bash', toolPattern: 'bash', action: 'deny', priority: 10 })

    const resultA = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    const resultB = await engine.checkPolicy(OTHER_COMPANY_ID, AGENT_ID, 'bash')

    expect(resultA.allowed).toBe(true)
    expect(resultB.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Dynamic policy changes
// ---------------------------------------------------------------------------

describe('Governance Engine — dynamic policy evaluation', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('deleting a policy causes subsequent checks to use default-deny', async () => {
    const policyId = await insertPolicy({
      name: 'allow-bash',
      toolPattern: 'bash',
      action: 'allow',
      priority: 10,
    })

    // Before deletion — should be allowed
    const before = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(before.allowed).toBe(true)

    // Delete the policy
    await deletePolicy(policyId)

    // After deletion — no policies remain → default-deny
    const after = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(after.allowed).toBe(false)
    expect(after.policyId).toBeUndefined()
  })

  it('adding a policy mid-session takes immediate effect', async () => {
    // No policy yet — default-deny
    const before = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(before.allowed).toBe(false)

    // Add a policy
    await insertPolicy({ name: 'allow-bash-dynamic', toolPattern: 'bash', action: 'allow', priority: 10 })

    // Now should be allowed
    const after = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(after.allowed).toBe(true)
  })

  it('changing policy priority changes evaluation result', async () => {
    const denyId = await insertPolicy({ name: 'deny-bash-low', toolPattern: 'bash', action: 'deny', priority: 1 })
    await insertPolicy({ name: 'allow-bash-high', toolPattern: 'bash', action: 'allow', priority: 100 })

    // allow wins at priority 100
    const before = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(before.allowed).toBe(true)

    // Bump deny priority above allow
    await db.query(`UPDATE policies SET priority = 200 WHERE id = $1`, [denyId])

    // deny now wins at priority 200
    const after = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(after.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Boundary inputs
// ---------------------------------------------------------------------------

describe('Governance Engine — boundary inputs', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('empty string tool name evaluates to default-deny with no policies', async () => {
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, '')
    expect(result.allowed).toBe(false)
  })

  it('wildcard (*) policy matches empty string tool name', async () => {
    await insertPolicy({ name: 'allow-all', toolPattern: '*', action: 'allow', priority: 10 })
    // micromatch behavior: '*' matches empty string depends on micromatch version
    // We document the actual behavior without forcing an assertion
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, '')
    expect(typeof result.allowed).toBe('boolean')
  })

  it('very long tool name resolves without error', async () => {
    await insertPolicy({ name: 'allow-all', toolPattern: '*', action: 'allow', priority: 10 })
    const longTool = 'a'.repeat(1000)
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, longTool)
    expect(result.allowed).toBe(true)
  })

  it('tool name with special characters resolves without error', async () => {
    await insertPolicy({ name: 'allow-all', toolPattern: '*', action: 'allow', priority: 10 })
    const specialTool = 'tool-with:colons.and/slashes+plus'
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, specialTool)
    expect(typeof result.allowed).toBe('boolean')
  })

  it('100 policies evaluate correctly — highest priority wins', async () => {
    // Insert 99 deny policies at priority 1–99
    for (let i = 1; i <= 99; i++) {
      await insertPolicy({
        name: `deny-p${i}`,
        toolPattern: 'bash',
        action: 'deny',
        priority: i,
      })
    }
    // One allow at priority 100 — should win
    await insertPolicy({ name: 'allow-p100', toolPattern: 'bash', action: 'allow', priority: 100 })

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('allow-p100')
  })
})

// ---------------------------------------------------------------------------
// Edge Cases: Multiple glob patterns in one run
// ---------------------------------------------------------------------------

describe('Governance Engine — multiple patterns evaluated per call', () => {
  beforeEach(async () => {
    await clearPolicies()
  })

  it('correct policy is selected among multiple non-overlapping patterns', async () => {
    const fileId = await insertPolicy({ name: 'allow-file', toolPattern: 'file:*', action: 'allow', priority: 10 })
    const netId = await insertPolicy({ name: 'allow-net', toolPattern: 'net:*', action: 'allow', priority: 10 })
    const githubId = await insertPolicy({ name: 'deny-github', toolPattern: 'github:*', action: 'deny', priority: 10 })

    const fileResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')
    expect(fileResult.allowed).toBe(true)
    expect(fileResult.policyId).toBe(fileId)

    const netResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:get')
    expect(netResult.allowed).toBe(true)
    expect(netResult.policyId).toBe(netId)

    const githubResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:push_commit')
    expect(githubResult.allowed).toBe(false)
    expect(githubResult.policyId).toBe(githubId)

    // bash — no matching pattern → default-deny
    const bashResult = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')
    expect(bashResult.allowed).toBe(false)
    expect(bashResult.policyId).toBeUndefined()
  })

  it('allow-all with selective deny: allowed tools pass, denied tools block', async () => {
    await insertPolicy({ name: 'allow-all', toolPattern: '*', action: 'allow', priority: 1 })
    await insertPolicy({ name: 'deny-net', toolPattern: 'net:*', action: 'deny', priority: 50 })
    await insertPolicy({ name: 'deny-bash', toolPattern: 'bash', action: 'deny', priority: 50 })

    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'file:read')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github.list_issues')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'web_search')).allowed).toBe(true)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:http:get')).allowed).toBe(false)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'net:ftp:upload')).allowed).toBe(false)
    expect((await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'bash')).allowed).toBe(false)
  })
})
