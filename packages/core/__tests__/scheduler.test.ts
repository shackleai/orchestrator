import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType } from '@shackleai/shared'
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
    it('delegates execution to the executor and returns its result', async () => {
      const executor: RunnerExecutor = vi.fn(async () => ({
        exitCode: 0,
        stdout: 'done',
        usage: { tokens: 100 },
        sessionIdAfter: 'sess-123',
      }))

      scheduler = new Scheduler(db, executor)
      const result = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )

      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(0)
      expect(result!.stdout).toBe('done')
      expect(executor).toHaveBeenCalledWith(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )
    })

    it('returns result with non-zero exit code from executor', async () => {
      const failExecutor: RunnerExecutor = vi.fn(async () => ({
        exitCode: 1,
        stderr: 'crash',
      }))

      scheduler = new Scheduler(db, failExecutor)
      const result = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Api,
      )

      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(1)
      expect(result!.stderr).toBe('crash')
    })

    it('returns result for unknown agent (executor handles error)', async () => {
      // The executor is responsible for returning an error result for unknown agents.
      // The scheduler just forwards whatever the executor returns.
      const executor: RunnerExecutor = vi.fn(async () => ({
        exitCode: 1,
        stderr: 'Agent not found',
      }))

      scheduler = new Scheduler(db, executor)
      const result = await scheduler.triggerNow(
        '00000000-0000-4000-a000-999999999999',
        TriggerType.Manual,
      )

      expect(result).not.toBeNull()
      expect(result!.exitCode).toBe(1)
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
      expect(firstResult).not.toBeNull()
      expect(firstResult!.exitCode).toBe(0)

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
      const result = await scheduler.triggerNow(
        AGENT_ONDEMAND_ID,
        TriggerType.Manual,
      )

      // Returns null on error
      expect(result).toBeNull()

      // Agent should no longer be marked as running
      expect(scheduler.isRunning(AGENT_ONDEMAND_ID)).toBe(false)
    })
  })
})
