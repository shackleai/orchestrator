/**
 * E2E: Governance enforcement during heartbeat execution
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType, HeartbeatRunStatus } from '@shackleai/shared'
import { CostTracker } from '../../packages/core/src/cost-tracker.js'
import { Observatory } from '../../packages/core/src/observatory.js'
import { GovernanceEngine } from '../../packages/core/src/governance/engine.js'
import { AdapterRegistry } from '../../packages/core/src/adapters/index.js'
import type { AdapterModule, AdapterResult } from '../../packages/core/src/adapters/index.js'
import { HeartbeatExecutor } from '../../packages/core/src/runner/executor.js'

const COMPANY_ID = '00000000-0000-4000-a000-000000000001'
const AGENT_ID = '00000000-0000-4000-a000-000000000020'

function createMockAdapter(overrides: Partial<AdapterResult> = {}): AdapterModule {
  return {
    type: 'process',
    label: 'Mock Process',
    execute: vi.fn(async () => ({ exitCode: 0, stdout: 'adapter executed', stderr: '', ...overrides })),
  }
}

async function seedTestData(db: DatabaseProvider): Promise<void> {
  await db.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Governance Corp', 'active', 'GOVC', 0, 100000, 0],
  )
  await db.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [AGENT_ID, COMPANY_ID, 'governed-bot', 'process', '{"command":"echo","args":["hello"]}', 10000, 0],
  )
}

describe('E2E: governance enforcement during heartbeat execution', () => {
  let db: PGliteProvider
  let costTracker: CostTracker
  let observatory: Observatory
  let governance: GovernanceEngine

  beforeAll(async () => {
    db = new PGliteProvider()
    await runMigrations(db)
    await seedTestData(db)
    costTracker = new CostTracker(db)
    observatory = new Observatory(db)
    governance = new GovernanceEngine(db)
  })

  afterAll(async () => { await db.close() })

  it('denies heartbeat when deny-all policy exists', async () => {
    await db.query(`INSERT INTO policies (company_id, name, tool_pattern, action, priority) VALUES ($1, $2, $3, $4, $5)`, [COMPANY_ID, 'deny-all', '*', 'deny', 10])
    const mockAdapter = createMockAdapter()
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry, governance)
    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Governance violation')
    expect(result.stderr).toContain('deny-all')
    expect(mockAdapter.execute).not.toHaveBeenCalled()
    const runs = await db.query<{ status: string; error: string | null }>(`SELECT status, error FROM heartbeat_runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [AGENT_ID])
    expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Failed)
    const activity = await db.query<{ action: string }>(`SELECT action FROM activity_log WHERE actor_id = $1 AND action = 'governance_violation' ORDER BY created_at DESC LIMIT 1`, [AGENT_ID])
    expect(activity.rows.length).toBe(1)
  })

  it('allows heartbeat when higher-priority allow policy exists', async () => {
    await db.query(`INSERT INTO policies (company_id, name, tool_pattern, action, priority) VALUES ($1, $2, $3, $4, $5)`, [COMPANY_ID, 'allow-process', 'process', 'allow', 100])
    const mockAdapter = createMockAdapter()
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry, governance)
    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(0)
    expect(mockAdapter.execute).toHaveBeenCalledOnce()
  })

  it('denies heartbeat when no policies exist (default-deny)', async () => {
    await db.query(`DELETE FROM policies WHERE company_id = $1`, [COMPANY_ID])
    const mockAdapter = createMockAdapter()
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry, governance)
    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Governance violation')
    expect(result.stderr).toContain('default deny')
    expect(mockAdapter.execute).not.toHaveBeenCalled()
  })

  it('skips governance when GovernanceEngine not provided', async () => {
    const mockAdapter = createMockAdapter()
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)
    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(0)
    expect(mockAdapter.execute).toHaveBeenCalledOnce()
  })

  it('enforces agent-specific deny over company-wide allow', async () => {
    await db.query(`DELETE FROM policies WHERE company_id = $1`, [COMPANY_ID])
    await db.query(`INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority) VALUES ($1, NULL, $2, $3, $4, $5)`, [COMPANY_ID, 'company-allow', 'process', 'allow', 50])
    await db.query(`INSERT INTO policies (company_id, agent_id, name, tool_pattern, action, priority) VALUES ($1, $2, $3, $4, $5, $6)`, [COMPANY_ID, AGENT_ID, 'agent-deny', 'process', 'deny', 50])
    const mockAdapter = createMockAdapter()
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry, governance)
    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Governance violation')
    expect(mockAdapter.execute).not.toHaveBeenCalled()
  })
})
