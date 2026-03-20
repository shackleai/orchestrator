import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import {
  TriggerType,
  HeartbeatRunStatus,
  AgentStatus,
} from '@shackleai/shared'
import { CostTracker } from '../src/cost-tracker.js'
import { Observatory } from '../src/observatory.js'
import { AdapterRegistry } from '../src/adapters/index.js'
import type { AdapterModule, AdapterResult } from '../src/adapters/index.js'
import { HeartbeatExecutor } from '../src/runner/executor.js'

let db: PGliteProvider
let costTracker: CostTracker
let observatory: Observatory
let registry: AdapterRegistry
let executor: HeartbeatExecutor

const COMPANY_ID = '00000000-0000-4000-a000-000000000001'
const AGENT_ID = '00000000-0000-4000-a000-000000000010'
const AGENT_OVERBUDGET_ID = '00000000-0000-4000-a000-000000000011'
const AGENT_UNKNOWN_ADAPTER_ID = '00000000-0000-4000-a000-000000000012'

/** A mock adapter that succeeds and returns configurable results. */
function createMockAdapter(
  overrides: Partial<AdapterResult> = {},
): AdapterModule {
  return {
    type: 'process',
    label: 'Mock Process',
    execute: vi.fn(async () => ({
      exitCode: 0,
      stdout: 'hello from adapter',
      stderr: '',
      ...overrides,
    })),
  }
}

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Executor Co', 'active', 'EXC', 0, 100000, 0],
  )

  // Normal agent with process adapter
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_ID,
      COMPANY_ID,
      'exec-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['hello'] }),
      10000,
      0,
    ],
  )

  // Over-budget agent (spent >= budget)
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_OVERBUDGET_ID,
      COMPANY_ID,
      'broke-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['nope'] }),
      1000,
      1500,
    ],
  )

  // Insert cost_events so checkBudget (which sums cost_events) sees over-budget spend
  await provider.query(
    `INSERT INTO cost_events (id, company_id, agent_id, cost_cents, provider, model, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      '00000000-0000-4000-a000-000000000099',
      COMPANY_ID,
      AGENT_OVERBUDGET_ID,
      1500,
      'test',
      'test-model',
    ],
  )

  // Agent with unknown adapter type
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_UNKNOWN_ADAPTER_ID,
      COMPANY_ID,
      'mystery-bot',
      'nonexistent',
      JSON.stringify({}),
      10000,
      0,
    ],
  )
}

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  await seedTestData(db)
  costTracker = new CostTracker(db)
  observatory = new Observatory(db)
})

afterAll(async () => {
  await db.close()
})

describe('HeartbeatExecutor', () => {
  describe('full heartbeat flow', () => {
    it('executes a successful heartbeat end-to-end', async () => {
      const mockAdapter = createMockAdapter({
        sessionState: 'session-abc',
      })
      registry = new AdapterRegistry()
      registry.register(mockAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(AGENT_ID, TriggerType.Manual)

      // Result should reflect adapter output
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello from adapter')
      expect(result.sessionIdAfter).toBe('session-abc')

      // Verify heartbeat_run was created
      const runs = await db.query<{
        status: string
        trigger_type: string
        exit_code: number
        session_id_after: string | null
        started_at: Date | null
        finished_at: Date | null
      }>(
        `SELECT status, trigger_type, exit_code, session_id_after, started_at, finished_at
         FROM heartbeat_runs WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [AGENT_ID],
      )

      expect(runs.rows).toHaveLength(1)
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Success)
      expect(runs.rows[0].trigger_type).toBe(TriggerType.Manual)
      expect(runs.rows[0].exit_code).toBe(0)
      expect(runs.rows[0].session_id_after).toBe('session-abc')
      expect(runs.rows[0].started_at).not.toBeNull()
      expect(runs.rows[0].finished_at).not.toBeNull()

      // Verify agent was set back to idle
      const agent = await db.query<{ status: string; last_heartbeat_at: Date | null }>(
        'SELECT status, last_heartbeat_at FROM agents WHERE id = $1',
        [AGENT_ID],
      )
      expect(agent.rows[0].status).toBe(AgentStatus.Idle)
      expect(agent.rows[0].last_heartbeat_at).not.toBeNull()

      // Verify adapter was called with correct context
      expect(mockAdapter.execute).toHaveBeenCalledOnce()
    })

    it('records cost when adapter reports usage', async () => {
      const mockAdapter = createMockAdapter({
        usage: {
          inputTokens: 500,
          outputTokens: 200,
          costCents: 42,
          model: 'claude-opus-4',
          provider: 'anthropic',
        },
      })
      registry = new AdapterRegistry()
      registry.register(mockAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      // Record initial spent
      const beforeAgent = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM agents WHERE id = $1',
        [AGENT_ID],
      )
      const spentBefore = beforeAgent.rows[0].spent_monthly_cents

      await executor.execute(AGENT_ID, TriggerType.Manual)

      // Verify cost_events row was inserted
      const events = await db.query<{
        cost_cents: number
        provider: string
        model: string
      }>(
        `SELECT cost_cents, provider, model FROM cost_events
         WHERE agent_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [AGENT_ID],
      )
      expect(events.rows).toHaveLength(1)
      expect(events.rows[0].cost_cents).toBe(42)
      expect(events.rows[0].provider).toBe('anthropic')
      expect(events.rows[0].model).toBe('claude-opus-4')

      // Verify spent was incremented
      const afterAgent = await db.query<{ spent_monthly_cents: number }>(
        'SELECT spent_monthly_cents FROM agents WHERE id = $1',
        [AGENT_ID],
      )
      expect(afterAgent.rows[0].spent_monthly_cents).toBe(spentBefore + 42)
    })
  })

  describe('budget enforcement', () => {
    it('blocks execution when agent exceeds budget', async () => {
      const mockAdapter = createMockAdapter()
      registry = new AdapterRegistry()
      registry.register(mockAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(
        AGENT_OVERBUDGET_ID,
        TriggerType.Manual,
      )

      // Should fail with budget error
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Budget exceeded')

      // Adapter should NOT have been called
      expect(mockAdapter.execute).not.toHaveBeenCalled()

      // Heartbeat run should be marked failed
      const runs = await db.query<{ status: string; error: string }>(
        `SELECT status, error FROM heartbeat_runs WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [AGENT_OVERBUDGET_ID],
      )
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Failed)
      expect(runs.rows[0].error).toContain('Budget exceeded')

      // Agent should be back to idle
      const agent = await db.query<{ status: string }>(
        'SELECT status FROM agents WHERE id = $1',
        [AGENT_OVERBUDGET_ID],
      )
      expect(agent.rows[0].status).toBe(AgentStatus.Idle)
    })
  })

  describe('adapter errors', () => {
    it('handles adapter returning non-zero exit code', async () => {
      const failAdapter = createMockAdapter({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      })
      registry = new AdapterRegistry()
      registry.register(failAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(AGENT_ID, TriggerType.Api)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('command not found')

      // Heartbeat run should be marked failed
      const runs = await db.query<{ status: string; error: string }>(
        `SELECT status, error FROM heartbeat_runs WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [AGENT_ID],
      )
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Failed)
    })

    it('handles adapter throwing an exception', async () => {
      const throwingAdapter: AdapterModule = {
        type: 'process',
        label: 'Throwing Process',
        execute: vi.fn(async () => {
          throw new Error('adapter exploded')
        }),
      }
      registry = new AdapterRegistry()
      registry.register(throwingAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(AGENT_ID, TriggerType.Manual)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('adapter exploded')

      // Heartbeat run should be marked failed
      const runs = await db.query<{ status: string; error: string }>(
        `SELECT status, error FROM heartbeat_runs WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [AGENT_ID],
      )
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Failed)
      expect(runs.rows[0].error).toBe('adapter exploded')

      // Agent should be back to idle
      const agent = await db.query<{ status: string }>(
        'SELECT status FROM agents WHERE id = $1',
        [AGENT_ID],
      )
      expect(agent.rows[0].status).toBe(AgentStatus.Idle)
    })

    it('returns error for unknown adapter type', async () => {
      registry = new AdapterRegistry()
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      // Use an agent with a registered adapter type that's NOT in the empty registry
      const result = await executor.execute(
        AGENT_UNKNOWN_ADAPTER_ID,
        TriggerType.Manual,
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown adapter type')
    })
  })

  describe('agent not found', () => {
    it('returns error for nonexistent agent', async () => {
      registry = new AdapterRegistry()
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(
        '00000000-0000-4000-a000-999999999999',
        TriggerType.Manual,
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Agent not found')
    })
  })

  describe('observatory logging', () => {
    it('logs events for successful heartbeats', async () => {
      const mockAdapter = createMockAdapter()
      registry = new AdapterRegistry()
      registry.register(mockAdapter)
      const spyObservatory = new Observatory(db)
      const logSpy = vi.spyOn(spyObservatory, 'logEvent')

      executor = new HeartbeatExecutor(
        db,
        costTracker,
        spyObservatory,
        registry,
      )

      await executor.execute(AGENT_ID, TriggerType.Manual)

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          company_id: COMPANY_ID,
          entity_type: 'heartbeat_run',
          actor_type: 'agent',
          actor_id: AGENT_ID,
          action: 'heartbeat_success',
        }),
      )
    })

    it('logs events for failed heartbeats', async () => {
      const throwingAdapter: AdapterModule = {
        type: 'process',
        label: 'Throwing',
        execute: vi.fn(async () => {
          throw new Error('kaboom')
        }),
      }
      registry = new AdapterRegistry()
      registry.register(throwingAdapter)
      const spyObservatory = new Observatory(db)
      const logSpy = vi.spyOn(spyObservatory, 'logEvent')

      executor = new HeartbeatExecutor(
        db,
        costTracker,
        spyObservatory,
        registry,
      )

      await executor.execute(AGENT_ID, TriggerType.Manual)

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'heartbeat_error',
          changes: expect.objectContaining({ error: 'kaboom' }),
        }),
      )
    })

    it('logs budget exceeded events', async () => {
      const mockAdapter = createMockAdapter()
      registry = new AdapterRegistry()
      registry.register(mockAdapter)
      const spyObservatory = new Observatory(db)
      const logSpy = vi.spyOn(spyObservatory, 'logEvent')

      executor = new HeartbeatExecutor(
        db,
        costTracker,
        spyObservatory,
        registry,
      )

      await executor.execute(AGENT_OVERBUDGET_ID, TriggerType.Manual)

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'budget_exceeded',
          actor_id: AGENT_OVERBUDGET_ID,
        }),
      )
    })
  })

  describe('timeout behavior', () => {
    it('times out slow adapters and marks run as timed_out', async () => {
      // Create agent with very short timeout
      const AGENT_TIMEOUT_ID = '00000000-0000-4000-a000-000000000013'
      await db.query(
        `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          AGENT_TIMEOUT_ID,
          COMPANY_ID,
          'slow-bot',
          'process',
          JSON.stringify({ timeout: 0.1 }), // 100ms timeout
          10000,
          0,
        ],
      )

      // Adapter that takes 2 seconds
      const slowAdapter: AdapterModule = {
        type: 'process',
        label: 'Slow Process',
        execute: vi.fn(
          () =>
            new Promise<AdapterResult>((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    exitCode: 0,
                    stdout: 'too late',
                    stderr: '',
                  }),
                2000,
              )
            }),
        ),
      }

      registry = new AdapterRegistry()
      registry.register(slowAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      const result = await executor.execute(
        AGENT_TIMEOUT_ID,
        TriggerType.Manual,
      )

      expect(result.exitCode).toBe(124)
      expect(result.stderr).toContain('timed out')

      // Heartbeat run should be marked timeout
      const runs = await db.query<{ status: string }>(
        `SELECT status FROM heartbeat_runs WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [AGENT_TIMEOUT_ID],
      )
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Timeout)

      // Agent should be back to idle
      const agent = await db.query<{ status: string }>(
        'SELECT status FROM agents WHERE id = $1',
        [AGENT_TIMEOUT_ID],
      )
      expect(agent.rows[0].status).toBe(AgentStatus.Idle)
    })
  })

  describe('agent status transitions', () => {
    it('transitions idle -> active -> idle during execution', async () => {
      let statusDuringExecution: string | undefined

      const inspectingAdapter: AdapterModule = {
        type: 'process',
        label: 'Inspecting Process',
        execute: async () => {
          // Check agent status mid-execution
          const agent = await db.query<{ status: string }>(
            'SELECT status FROM agents WHERE id = $1',
            [AGENT_ID],
          )
          statusDuringExecution = agent.rows[0].status
          return { exitCode: 0, stdout: 'ok', stderr: '' }
        },
      }

      registry = new AdapterRegistry()
      registry.register(inspectingAdapter)
      executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

      // Ensure agent starts idle
      await db.query('UPDATE agents SET status = $1 WHERE id = $2', [
        AgentStatus.Idle,
        AGENT_ID,
      ])

      await executor.execute(AGENT_ID, TriggerType.Manual)

      // During execution, agent should have been active
      expect(statusDuringExecution).toBe(AgentStatus.Active)

      // After execution, agent should be idle
      const agent = await db.query<{ status: string }>(
        'SELECT status FROM agents WHERE id = $1',
        [AGENT_ID],
      )
      expect(agent.rows[0].status).toBe(AgentStatus.Idle)
    })
  })
})
