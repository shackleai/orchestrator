import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType, HeartbeatRunStatus } from '@shackleai/shared'
import { Scheduler } from '../src/scheduler.js'
import type { RunnerExecutor } from '../src/scheduler.js'

let db: PGliteProvider
let scheduler: Scheduler

const COMPANY_ID = '00000000-0000-4000-a000-000000000001'
const AGENT_CRON_ID = '00000000-0000-4000-a000-000000000010'
const AGENT_ONDEMAND_ID = '00000000-0000-4000-a000-000000000011'

/** Default executor that succeeds immediately. */
const successExecutor: RunnerExecutor = vi.fn(async () => ({
  exitCode: 0,
  stdout: 'ok',
}))

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Scheduler Co', 'active', 'SCH', 0, 10000, 0],
  )

  // Agent with cron in adapter_config
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      AGENT_CRON_ID,
      COMPANY_ID,
      'cron-bot',
      'process',
      JSON.stringify({ cron: '*/5 * * * *' }),
    ],
  )

  // Agent without cron (on-demand only)
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      AGENT_ONDEMAND_ID,
      COMPANY_ID,
      'demand-bot',
      'process',
      JSON.stringify({}),
    ],
  )
}

beforeAll(async () => {
  db = new PGliteProvider()
  await runMigrations(db)
  await seedTestData(db)
})

afterEach(() => {
  scheduler?.stop()
  vi.clearAllMocks()
})

afterAll(async () => {
  await db.close()
})

describe('Scheduler', () => {
  describe('start / stop lifecycle', () => {
    it('starts and loads cron agents from DB', async () => {
      scheduler = new Scheduler(db, successExecutor)
      expect(scheduler.isStarted()).toBe(false)

      await scheduler.start()
      expect(scheduler.isStarted()).toBe(true)
      // Should have registered the cron agent but not the on-demand one
      expect(scheduler.scheduleCount).toBe(1)
    })

    it('does not start twice', async () => {
      scheduler = new Scheduler(db, successExecutor)
      await scheduler.start()
      const count = scheduler.scheduleCount
      await scheduler.start() // no-op
      expect(scheduler.scheduleCount).toBe(count)
    })

    it('stop clears all schedules', async () => {
      scheduler = new Scheduler(db, successExecutor)
      await scheduler.start()
      expect(scheduler.scheduleCount).toBe(1)

      scheduler.stop()
      expect(scheduler.scheduleCount).toBe(0)
      expect(scheduler.isStarted()).toBe(false)
    })
  })

  describe('registerAgent', () => {
    it('registers agent with cron expression', () => {
      scheduler = new Scheduler(db, successExecutor)
      scheduler.registerAgent(AGENT_ONDEMAND_ID, '*/10 * * * *')
      expect(scheduler.scheduleCount).toBe(1)
    })

    it('replaces existing schedule for same agent', () => {
      scheduler = new Scheduler(db, successExecutor)
      scheduler.registerAgent(AGENT_CRON_ID, '*/5 * * * *')
      expect(scheduler.scheduleCount).toBe(1)
      scheduler.registerAgent(AGENT_CRON_ID, '*/10 * * * *')
      expect(scheduler.scheduleCount).toBe(1)
    })

    it('skips invalid cron expressions', () => {
      scheduler = new Scheduler(db, successExecutor)
      scheduler.registerAgent(AGENT_CRON_ID, 'not-a-cron')
      expect(scheduler.scheduleCount).toBe(0)
    })

    it('no-ops without cron expression (on-demand only)', () => {
      scheduler = new Scheduler(db, successExecutor)
      scheduler.registerAgent(AGENT_ONDEMAND_ID)
      expect(scheduler.scheduleCount).toBe(0)
    })
  })

  describe('triggerNow — on-demand', () => {
    it('executes heartbeat and creates a run record', async () => {
      const executor: RunnerExecutor = vi.fn(async () => ({
        exitCode: 0,
        stdout: 'done',
        usage: { tokens: 100 },
        sessionIdAfter: 'sess-123',
      }))

      scheduler = new Scheduler(db, executor)
      const runId = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )

      expect(runId).toBeTruthy()
      expect(executor).toHaveBeenCalledWith(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )

      // Verify heartbeat_runs record
      const runs = await db.query<{
        id: string
        status: string
        trigger_type: string
        exit_code: number
        stdout_excerpt: string
        session_id_after: string
      }>('SELECT * FROM heartbeat_runs WHERE id = $1', [runId])

      expect(runs.rows).toHaveLength(1)
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Success)
      expect(runs.rows[0].trigger_type).toBe(TriggerType.Manual)
      expect(runs.rows[0].exit_code).toBe(0)
      expect(runs.rows[0].stdout_excerpt).toBe('done')
      expect(runs.rows[0].session_id_after).toBe('sess-123')
    })

    it('marks failed runs with exit code and error', async () => {
      const failExecutor: RunnerExecutor = vi.fn(async () => ({
        exitCode: 1,
        stderr: 'crash',
      }))

      scheduler = new Scheduler(db, failExecutor)
      const runId = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Api,
      )

      expect(runId).toBeTruthy()

      const runs = await db.query<{ status: string; error: string }>(
        'SELECT status, error FROM heartbeat_runs WHERE id = $1',
        [runId],
      )
      expect(runs.rows[0].status).toBe(HeartbeatRunStatus.Failed)
      expect(runs.rows[0].error).toBe('crash')
    })

    it('returns null for unknown agent', async () => {
      scheduler = new Scheduler(db, successExecutor)
      const runId = await scheduler.triggerNow(
        '00000000-0000-4000-a000-999999999999',
        TriggerType.Manual,
      )
      expect(runId).toBeNull()
    })

    it('updates agent last_heartbeat_at', async () => {
      scheduler = new Scheduler(db, successExecutor)

      // Clear existing heartbeat_at
      await db.query(
        'UPDATE agents SET last_heartbeat_at = NULL WHERE id = $1',
        [AGENT_ONDEMAND_ID],
      )

      await scheduler.triggerNow(AGENT_ONDEMAND_ID, TriggerType.Manual)

      const agent = await db.query<{ last_heartbeat_at: Date | null }>(
        'SELECT last_heartbeat_at FROM agents WHERE id = $1',
        [AGENT_ONDEMAND_ID],
      )
      expect(agent.rows[0].last_heartbeat_at).not.toBeNull()
    })
  })

  describe('coalescing', () => {
    it('skips heartbeat if agent is already running', async () => {
      let resolveFirst: (() => void) | undefined
      const blockingPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })

      let callCount = 0
      const slowExecutor: RunnerExecutor = async () => {
        callCount++
        if (callCount === 1) {
          await blockingPromise
        }
        return { exitCode: 0 }
      }

      scheduler = new Scheduler(db, slowExecutor)

      // Start first heartbeat (will block)
      const firstPromise = scheduler.triggerNow(
        AGENT_CRON_ID,
        TriggerType.Cron,
      )

      // While first is running, try second
      expect(scheduler.isRunning(AGENT_CRON_ID)).toBe(true)
      const secondResult = await scheduler.triggerNow(
        AGENT_CRON_ID,
        TriggerType.Manual,
      )

      // Second should be coalesced (skipped)
      expect(secondResult).toBeNull()

      // Unblock first
      resolveFirst!()
      const firstResult = await firstPromise
      expect(firstResult).toBeTruthy()

      // Executor was only called once
      expect(callCount).toBe(1)
    })
  })

  describe('error handling', () => {
    it('handles executor throwing an exception', async () => {
      const throwingExecutor: RunnerExecutor = vi.fn(async () => {
        throw new Error('adapter crashed')
      })

      scheduler = new Scheduler(db, throwingExecutor)
      const runId = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )

      // Returns null on error
      expect(runId).toBeNull()

      // Agent should no longer be marked as running
      expect(scheduler.isRunning(AGENT_ONDEMAND_ID)).toBe(false)
    })
  })
})
