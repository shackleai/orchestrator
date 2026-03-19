import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import { PolicyAction } from '@shackleai/shared'
import { GovernanceEngine } from '../src/governance/index.js'
import { QuotaManager } from '../src/quota/index.js'

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
// QuotaManager
// ---------------------------------------------------------------------------

describe('QuotaManager', () => {
  let db: PGliteProvider
  let quotaManager: QuotaManager

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)

    await db.exec(`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Quota Corp', 'QC');
    `)
    await db.exec(`
      INSERT INTO agents (id, company_id, name, role, adapter_type, adapter_config)
      VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Agent Q', 'worker', 'process', '{}');
    `)

    quotaManager = new QuotaManager(db)
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    await db.exec('DELETE FROM quota_windows')
    await db.exec('DELETE FROM cost_events')
  })

  it('should allow when no quotas exist', async () => {
    const result = await quotaManager.checkQuota(COMPANY_ID, AGENT_ID, 'anthropic')
    expect(result.allowed).toBe(true)
  })

  it('should deny when request quota is exceeded', async () => {
    await db.query(
      `INSERT INTO quota_windows (company_id, agent_id, provider, window_duration, max_requests)
       VALUES ($1, $2, $3, $4, $5)`,
      [COMPANY_ID, AGENT_ID, 'anthropic', '1h', 3],
    )

    for (let i = 0; i < 3; i++) {
      await db.query(
        `INSERT INTO cost_events (company_id, agent_id, provider, input_tokens, output_tokens, cost_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [COMPANY_ID, AGENT_ID, 'anthropic', 100, 50, 1],
      )
    }

    const result = await quotaManager.checkQuota(COMPANY_ID, AGENT_ID, 'anthropic')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Request quota exceeded')
    expect(result.quotaId).toBeDefined()
  })

  it('should deny when token quota is exceeded', async () => {
    await db.query(
      `INSERT INTO quota_windows (company_id, agent_id, provider, window_duration, max_tokens)
       VALUES ($1, $2, $3, $4, $5)`,
      [COMPANY_ID, AGENT_ID, 'anthropic', '1h', 500],
    )

    await db.query(
      `INSERT INTO cost_events (company_id, agent_id, provider, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'anthropic', 100, 500, 10],
    )

    const result = await quotaManager.checkQuota(COMPANY_ID, AGENT_ID, 'anthropic')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Token quota exceeded')
  })

  it('should apply company-wide quotas', async () => {
    await db.query(
      `INSERT INTO quota_windows (company_id, agent_id, provider, window_duration, max_requests)
       VALUES ($1, NULL, $2, $3, $4)`,
      [COMPANY_ID, 'anthropic', '1h', 2],
    )

    for (let i = 0; i < 2; i++) {
      await db.query(
        `INSERT INTO cost_events (company_id, agent_id, provider, input_tokens, output_tokens, cost_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [COMPANY_ID, AGENT_ID, 'anthropic', 100, 50, 1],
      )
    }

    const result = await quotaManager.checkQuota(COMPANY_ID, AGENT_ID, 'anthropic')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('company')
  })

  it('should return quota status with current usage', async () => {
    await db.query(
      `INSERT INTO quota_windows (company_id, agent_id, provider, window_duration, max_requests, max_tokens)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'anthropic', '1h', 10, 10000],
    )

    await db.query(
      `INSERT INTO cost_events (company_id, agent_id, provider, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [COMPANY_ID, AGENT_ID, 'anthropic', 200, 300, 5],
    )

    const statuses = await quotaManager.getQuotaStatus(COMPANY_ID, AGENT_ID)
    expect(statuses).toHaveLength(1)
    expect(statuses[0].current_requests).toBe(1)
    expect(statuses[0].current_tokens).toBe(500)
    expect(statuses[0].exceeded).toBe(false)
  })
})
