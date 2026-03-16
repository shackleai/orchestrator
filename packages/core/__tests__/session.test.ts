import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import {
  getLastSessionState,
  saveSessionState,
} from '../src/adapters/session.js'

let db: PGliteProvider

const COMPANY_ID = '00000000-0000-4000-a000-000000000001'
const AGENT_ID = '00000000-0000-4000-a000-000000000010'
const RUN_ID_1 = '00000000-0000-4000-a000-000000000100'
const RUN_ID_2 = '00000000-0000-4000-a000-000000000101'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'Session Co', 'active', 'SES', 0, 10000, 0],
  )

  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [AGENT_ID, COMPANY_ID, 'session-bot', 'process', 5000, 0],
  )
}

beforeAll(async () => {
  db = new PGliteProvider() // in-memory
  await runMigrations(db)
  await seedTestData(db)
})

afterAll(async () => {
  await db.close()
})

describe('SessionManager', () => {
  it('returns null when no prior runs exist', async () => {
    const state = await getLastSessionState(AGENT_ID, db)
    expect(state).toBeNull()
  })

  it('saves session state to a heartbeat run', async () => {
    // Create a heartbeat run first
    await db.query(
      `INSERT INTO heartbeat_runs (id, company_id, agent_id, trigger_type, status, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [RUN_ID_1, COMPANY_ID, AGENT_ID, 'cron', 'success'],
    )

    await saveSessionState(RUN_ID_1, 'session-state-abc', db)

    // Verify directly
    const result = await db.query<{ session_id_after: string | null }>(
      `SELECT session_id_after FROM heartbeat_runs WHERE id = $1`,
      [RUN_ID_1],
    )
    expect(result.rows[0].session_id_after).toBe('session-state-abc')
  })

  it('retrieves the last session state for an agent', async () => {
    const state = await getLastSessionState(AGENT_ID, db)
    expect(state).toBe('session-state-abc')
  })

  it('returns the most recent session state when multiple runs exist', async () => {
    // Create a second, newer heartbeat run
    await db.query(
      `INSERT INTO heartbeat_runs (id, company_id, agent_id, trigger_type, status, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 minute', NOW() + INTERVAL '1 minute')`,
      [RUN_ID_2, COMPANY_ID, AGENT_ID, 'manual', 'success'],
    )

    await saveSessionState(RUN_ID_2, 'session-state-def', db)

    const state = await getLastSessionState(AGENT_ID, db)
    expect(state).toBe('session-state-def')
  })

  it('ignores failed runs when fetching session state', async () => {
    const failedRunId = '00000000-0000-4000-a000-000000000102'

    // Create a failed run with a session state — should be ignored
    await db.query(
      `INSERT INTO heartbeat_runs (id, company_id, agent_id, trigger_type, status, started_at, finished_at, session_id_after)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '2 minutes', NOW() + INTERVAL '2 minutes', $6)`,
      [failedRunId, COMPANY_ID, AGENT_ID, 'cron', 'failed', 'should-be-ignored'],
    )

    const state = await getLastSessionState(AGENT_ID, db)
    // Should still return the last *successful* run's state
    expect(state).toBe('session-state-def')
  })
})
