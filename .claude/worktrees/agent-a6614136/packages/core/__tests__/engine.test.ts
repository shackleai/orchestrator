import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { PolicyAction } from '@shackleai/shared'
import { GovernanceEngine, RateLimiter } from '../src/governance/index.js'

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const COMPANY_ID = '00000000-0000-0000-0000-000000000001'
const AGENT_ID = '00000000-0000-0000-0000-000000000002'
const OTHER_AGENT_ID = '00000000-0000-0000-0000-000000000003'

describe('GovernanceEngine', () => {
  let db: PGliteProvider
  let engine: GovernanceEngine

  beforeAll(async () => {
    db = new PGliteProvider() // in-memory
    await runMigrations(db)

    // Seed a company and agents (required by FK constraints)
    await db.exec(`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES ('${COMPANY_ID}', 'Test Corp', 'TC');
    `)
    await db.exec(`
      INSERT INTO agents (id, company_id, name, role, adapter_type, adapter_config)
      VALUES
        ('${AGENT_ID}', '${COMPANY_ID}', 'Agent A', 'worker', 'process', '{}'),
        ('${OTHER_AGENT_ID}', '${COMPANY_ID}', 'Agent B', 'worker', 'process', '{}');
    `)

    engine = new GovernanceEngine(db)
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    // Clean policies between tests for isolation
    await db.exec('DELETE FROM policies')
  })

  // -------------------------------------------------------------------------
  // Default-deny
  // -------------------------------------------------------------------------

  it('should deny when no policies exist (default-deny)', async () => {
    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')

    expect(result.allowed).toBe(false)
    expect(result.policyId).toBeUndefined()
    expect(result.reason).toContain('default deny')
  })

  // -------------------------------------------------------------------------
  // Exact tool name matching
  // -------------------------------------------------------------------------

  it('should allow when exact tool name matches an allow policy', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow GitHub Issues', 'github:list_issues', PolicyAction.Allow, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')

    expect(result.allowed).toBe(true)
    expect(result.policyId).toBeDefined()
    expect(result.reason).toContain('Allow GitHub Issues')
  })

  it('should deny when exact tool name matches a deny policy', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Deny Slack', 'slack:send_message', PolicyAction.Deny, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'slack:send_message')

    expect(result.allowed).toBe(false)
    expect(result.policyId).toBeDefined()
    expect(result.reason).toContain('Deny Slack')
  })

  // -------------------------------------------------------------------------
  // Glob pattern matching
  // -------------------------------------------------------------------------

  it('should match glob pattern "github:*"', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow All GitHub', 'github:*', PolicyAction.Allow, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:create_pr')

    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('Allow All GitHub')
  })

  it('should not match unrelated tools with glob pattern "github:*"', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow All GitHub', 'github:*', PolicyAction.Allow, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'slack:send_message')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('default deny')
  })

  it('should match wildcard "*" (allow-all policy)', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow Everything', '*', PolicyAction.Allow, 1],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'any:tool:name')

    expect(result.allowed).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Priority ordering
  // -------------------------------------------------------------------------

  it('should respect priority — higher priority wins', async () => {
    // Low priority: allow all
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow All', '*', PolicyAction.Allow, 1],
    )
    // High priority: deny github
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Deny GitHub', 'github:*', PolicyAction.Deny, 100],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:delete_repo')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Deny GitHub')
  })

  it('should allow non-denied tools when a higher-priority deny exists for others', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Allow All', '*', PolicyAction.Allow, 1],
    )
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Deny GitHub', 'github:*', PolicyAction.Deny, 100],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'slack:send_message')

    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('Allow All')
  })

  // -------------------------------------------------------------------------
  // Agent-specific vs company-wide
  // -------------------------------------------------------------------------

  it('should prefer agent-specific policy over company-wide at same priority', async () => {
    // Company-wide allow
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, NULL, $2, $3, $4, $5)`,
      [COMPANY_ID, 'Company Allow All', '*', PolicyAction.Allow, 10],
    )
    // Agent-specific deny at same priority
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Agent Deny All', '*', PolicyAction.Deny, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:list_issues')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Agent Deny All')
  })

  it('should fall back to company-wide policy when no agent-specific match', async () => {
    // Company-wide allow for all tools
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, NULL, $2, $3, $4, $5)`,
      [COMPANY_ID, 'Company Allow All', '*', PolicyAction.Allow, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'slack:send_message')

    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('Company Allow All')
  })

  it('should not leak agent-specific policies to other agents', async () => {
    // Policy for AGENT_ID only
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Agent A Allow', '*', PolicyAction.Allow, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, OTHER_AGENT_ID, 'github:list_issues')

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('default deny')
  })

  // -------------------------------------------------------------------------
  // Log action
  // -------------------------------------------------------------------------

  it('should allow with logging when action is "log"', async () => {
    await db.query(
      `INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'Log GitHub', 'github:*', PolicyAction.Log, 10],
    )

    const result = await engine.checkPolicy(COMPANY_ID, AGENT_ID, 'github:create_issue')

    expect(result.allowed).toBe(true)
    expect(result.reason).toContain('logging')
  })
})

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  let limiter: RateLimiter

  const POLICY_ID = '00000000-0000-0000-0000-000000000099'

  beforeEach(() => {
    limiter = new RateLimiter()
  })

  it('should allow calls within the rate limit', () => {
    // 10 calls per hour
    for (let i = 0; i < 10; i++) {
      expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 10)).toBe(true)
    }
  })

  it('should deny when rate limit is exceeded', () => {
    // 3 calls per hour — consume all tokens
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 3)).toBe(true)
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 3)).toBe(true)
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 3)).toBe(true)

    // 4th call should be denied
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 3)).toBe(false)
  })

  it('should track separate buckets per policy+agent pair', () => {
    // Exhaust AGENT_ID's bucket
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 1)).toBe(true)
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 1)).toBe(false)

    // OTHER_AGENT_ID should still have tokens
    expect(limiter.checkRateLimit(POLICY_ID, OTHER_AGENT_ID, 1)).toBe(true)
  })

  it('should deny when maxCallsPerHour is 0', () => {
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 0)).toBe(false)
  })

  it('should reset all buckets', () => {
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 1)).toBe(true)
    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 1)).toBe(false)

    limiter.reset()

    expect(limiter.checkRateLimit(POLICY_ID, AGENT_ID, 1)).toBe(true)
  })
})
