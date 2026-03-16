/**
 * Tests for agent communication context injection into AdapterContext.
 *
 * Verifies that recentActivity, assignedTasks, and unreadComments are
 * correctly populated during heartbeat execution.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType, AgentStatus } from '@shackleai/shared'
import { CostTracker } from '../src/cost-tracker.js'
import { Observatory } from '../src/observatory.js'
import { AdapterRegistry } from '../src/adapters/index.js'
import type { AdapterModule, AdapterContext, AdapterResult } from '../src/adapters/index.js'
import { HeartbeatExecutor } from '../src/runner/executor.js'

let db: PGliteProvider
let costTracker: CostTracker
let observatory: Observatory

const COMPANY_ID = '00000000-0000-4000-a000-000000000100'
const AGENT_ID = '00000000-0000-4000-a000-000000000101'
const OTHER_AGENT_ID = '00000000-0000-4000-a000-000000000102'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'CommContext Co', 'active', 'CTX', 10, 100000, 0],
  )

  // Agent with a past heartbeat timestamp
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      AGENT_ID,
      COMPANY_ID,
      'context-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['hello'] }),
      10000,
      0,
      '2025-01-01T00:00:00.000Z',
    ],
  )

  // Another agent for cross-agent comment testing
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      OTHER_AGENT_ID,
      COMPANY_ID,
      'other-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['other'] }),
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

describe('AdapterContext — agent communication fields', () => {
  it('injects recentActivity from activity_log since last heartbeat', async () => {
    // Insert activity log entries — some before, some after the agent's last heartbeat
    await db.query(
      `INSERT INTO activity_log (company_id, entity_type, actor_type, action, created_at)
       VALUES ($1, 'agent', 'system', 'old_event', '2024-12-01T00:00:00.000Z')`,
      [COMPANY_ID],
    )
    await db.query(
      `INSERT INTO activity_log (company_id, entity_type, actor_type, action, created_at)
       VALUES ($1, 'issue', 'agent', 'new_event', '2025-06-01T00:00:00.000Z')`,
      [COMPANY_ID],
    )

    let capturedCtx: AdapterContext | undefined
    const capturingAdapter: AdapterModule = {
      type: 'process',
      label: 'Capturing',
      execute: async (ctx) => {
        capturedCtx = ctx
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
    }

    const registry = new AdapterRegistry()
    registry.register(capturingAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_ID, TriggerType.Manual)

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.recentActivity).toBeDefined()
    expect(Array.isArray(capturedCtx!.recentActivity)).toBe(true)

    // Only the entry after 2025-01-01 should appear
    const actions = capturedCtx!.recentActivity!.map((a) => a.action)
    expect(actions).toContain('new_event')
    expect(actions).not.toContain('old_event')
  })

  it('injects assignedTasks with in_progress issues for this agent', async () => {
    // Create an in_progress issue assigned to our agent
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status, priority, assignee_agent_id)
       VALUES ($1, 'CTX-11', 11, 'Fix the widget', 'in_progress', 'medium', $2)`,
      [COMPANY_ID, AGENT_ID],
    )

    // Create a done issue (should not appear)
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status, priority, assignee_agent_id)
       VALUES ($1, 'CTX-12', 12, 'Done task', 'done', 'low', $2)`,
      [COMPANY_ID, AGENT_ID],
    )

    // Create an in_progress issue assigned to other agent (should not appear)
    await db.query(
      `INSERT INTO issues (company_id, identifier, issue_number, title, status, priority, assignee_agent_id)
       VALUES ($1, 'CTX-13', 13, 'Other agent task', 'in_progress', 'high', $2)`,
      [COMPANY_ID, OTHER_AGENT_ID],
    )

    let capturedCtx: AdapterContext | undefined
    const capturingAdapter: AdapterModule = {
      type: 'process',
      label: 'Capturing',
      execute: async (ctx) => {
        capturedCtx = ctx
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
    }

    const registry = new AdapterRegistry()
    registry.register(capturingAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_ID, TriggerType.Manual)

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.assignedTasks).toBeDefined()
    expect(Array.isArray(capturedCtx!.assignedTasks)).toBe(true)

    const titles = capturedCtx!.assignedTasks!.map((t) => t.title)
    expect(titles).toContain('Fix the widget')
    expect(titles).not.toContain('Done task')
    expect(titles).not.toContain('Other agent task')
  })

  it('injects unreadComments on agent tasks since last heartbeat', async () => {
    // Reset last_heartbeat_at to a known value (previous tests may have updated it via execute())
    await db.query(
      `UPDATE agents SET last_heartbeat_at = '2025-01-01T00:00:00.000Z' WHERE id = $1`,
      [AGENT_ID],
    )

    // Ensure agent has a task assigned
    const issueResult = await db.query<{ id: string }>(
      `SELECT id FROM issues WHERE identifier = 'CTX-11'`,
    )
    const issueId = issueResult.rows[0].id

    // Comment from other agent AFTER last heartbeat (should appear)
    await db.query(
      `INSERT INTO issue_comments (issue_id, author_agent_id, content, is_resolved, created_at)
       VALUES ($1, $2, 'Please review this', false, '2025-06-01T00:00:00.000Z')`,
      [issueId, OTHER_AGENT_ID],
    )

    // Comment from the agent itself (should NOT appear)
    await db.query(
      `INSERT INTO issue_comments (issue_id, author_agent_id, content, is_resolved, created_at)
       VALUES ($1, $2, 'My own comment', false, '2025-06-01T01:00:00.000Z')`,
      [issueId, AGENT_ID],
    )

    // Comment from BEFORE last heartbeat (should NOT appear)
    await db.query(
      `INSERT INTO issue_comments (issue_id, author_agent_id, content, is_resolved, created_at)
       VALUES ($1, $2, 'Old comment', false, '2024-12-01T00:00:00.000Z')`,
      [issueId, OTHER_AGENT_ID],
    )

    let capturedCtx: AdapterContext | undefined
    const capturingAdapter: AdapterModule = {
      type: 'process',
      label: 'Capturing',
      execute: async (ctx) => {
        capturedCtx = ctx
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
    }

    const registry = new AdapterRegistry()
    registry.register(capturingAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_ID, TriggerType.Manual)

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.unreadComments).toBeDefined()
    expect(Array.isArray(capturedCtx!.unreadComments)).toBe(true)

    const contents = capturedCtx!.unreadComments!.map((c) => c.content)
    expect(contents).toContain('Please review this')
    expect(contents).not.toContain('My own comment')
    expect(contents).not.toContain('Old comment')
  })

  it('returns empty unreadComments when agent has no previous heartbeat', async () => {
    // Create an agent with no last_heartbeat_at
    const FRESH_AGENT_ID = '00000000-0000-4000-a000-000000000103'
    await db.query(
      `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        FRESH_AGENT_ID,
        COMPANY_ID,
        'fresh-bot',
        'process',
        JSON.stringify({ command: 'echo' }),
        10000,
        0,
      ],
    )

    let capturedCtx: AdapterContext | undefined
    const capturingAdapter: AdapterModule = {
      type: 'process',
      label: 'Capturing',
      execute: async (ctx) => {
        capturedCtx = ctx
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
    }

    const registry = new AdapterRegistry()
    registry.register(capturingAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(FRESH_AGENT_ID, TriggerType.Manual)

    expect(capturedCtx).toBeDefined()
    // Fresh agent gets activity (no since filter — returns latest)
    expect(capturedCtx!.recentActivity).toBeDefined()
    // But unreadComments should be empty since there's no baseline
    expect(capturedCtx!.unreadComments).toEqual([])
  })

  it('caps recentActivity at 50 entries', async () => {
    // Create a company just for this test to avoid cross-contamination
    const CAP_COMPANY_ID = '00000000-0000-4000-a000-000000000200'
    const CAP_AGENT_ID = '00000000-0000-4000-a000-000000000201'

    await db.query(
      `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [CAP_COMPANY_ID, 'Cap Co', 'active', 'CAP', 0, 100000, 0],
    )

    await db.query(
      `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        CAP_AGENT_ID,
        CAP_COMPANY_ID,
        'cap-bot',
        'process',
        JSON.stringify({ command: 'echo' }),
        10000,
        0,
        '2025-01-01T00:00:00.000Z',
      ],
    )

    // Insert 60 activity entries after the agent's last heartbeat
    for (let i = 0; i < 60; i++) {
      await db.query(
        `INSERT INTO activity_log (company_id, entity_type, actor_type, action, created_at)
         VALUES ($1, 'agent', 'system', $2, $3)`,
        [CAP_COMPANY_ID, `event_${i}`, `2025-06-01T00:${String(i).padStart(2, '0')}:00.000Z`],
      )
    }

    let capturedCtx: AdapterContext | undefined
    const capturingAdapter: AdapterModule = {
      type: 'process',
      label: 'Capturing',
      execute: async (ctx) => {
        capturedCtx = ctx
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
    }

    const registry = new AdapterRegistry()
    registry.register(capturingAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(CAP_AGENT_ID, TriggerType.Manual)

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.recentActivity!.length).toBeLessThanOrEqual(50)
  })
})
