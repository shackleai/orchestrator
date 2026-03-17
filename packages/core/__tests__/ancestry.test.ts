/**
 * Goal Ancestry tests — verify that the HeartbeatExecutor resolves the full
 * mission → project → goal → task context chain into AdapterContext.ancestry.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType } from '@shackleai/shared'
import { CostTracker } from '../src/cost-tracker.js'
import { Observatory } from '../src/observatory.js'
import { AdapterRegistry } from '../src/adapters/index.js'
import type {
  AdapterContext,
  AdapterModule,
  AdapterResult,
} from '../src/adapters/index.js'
import { HeartbeatExecutor } from '../src/runner/executor.js'

let db: PGliteProvider
let costTracker: CostTracker
let observatory: Observatory

const COMPANY_ID = '00000000-0000-4000-a000-000000000100'
const AGENT_ID = '00000000-0000-4000-a000-000000000101'
const GOAL_ID = '00000000-0000-4000-a000-000000000201'
const PROJECT_ID = '00000000-0000-4000-a000-000000000301'
const ISSUE_FULL_ID = '00000000-0000-4000-a000-000000000401'
const ISSUE_NO_GOAL_ID = '00000000-0000-4000-a000-000000000402'
const ISSUE_NO_PROJECT_ID = '00000000-0000-4000-a000-000000000403'

const AGENT_NO_TASK_ID = '00000000-0000-4000-a000-000000000102'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  // Company with a mission (description)
  await provider.query(
    `INSERT INTO companies (id, name, description, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      COMPANY_ID,
      'Ancestry Co',
      'Build the best AI agent platform',
      'active',
      'ANC',
      10,
      100000,
      0,
    ],
  )

  // Agent with process adapter
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_ID,
      COMPANY_ID,
      'ancestry-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['hello'] }),
      10000,
      0,
    ],
  )

  // Agent with no task assigned
  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_NO_TASK_ID,
      COMPANY_ID,
      'idle-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['idle'] }),
      10000,
      0,
    ],
  )

  // Goal
  await provider.query(
    `INSERT INTO goals (id, company_id, title, description, level, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      GOAL_ID,
      COMPANY_ID,
      'Ship v1.0',
      'Release the first stable version',
      'milestone',
      'active',
    ],
  )

  // Project linked to goal
  await provider.query(
    `INSERT INTO projects (id, company_id, goal_id, name, description, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      PROJECT_ID,
      COMPANY_ID,
      GOAL_ID,
      'Core Engine',
      'Build the orchestration engine',
      'active',
    ],
  )

  // Issue with full ancestry (goal + project)
  await provider.query(
    `INSERT INTO issues (id, company_id, identifier, issue_number, title, description, goal_id, project_id, status, priority, assignee_agent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ISSUE_FULL_ID,
      COMPANY_ID,
      'ANC-1',
      1,
      'Implement heartbeat executor',
      'Build the core executor logic',
      GOAL_ID,
      PROJECT_ID,
      'in_progress',
      'high',
      AGENT_ID,
    ],
  )

  // Issue with NO goal (goal_id = null)
  await provider.query(
    `INSERT INTO issues (id, company_id, identifier, issue_number, title, description, goal_id, project_id, status, priority, assignee_agent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ISSUE_NO_GOAL_ID,
      COMPANY_ID,
      'ANC-2',
      2,
      'Fix documentation typos',
      null,
      null,
      PROJECT_ID,
      'in_progress',
      'low',
      AGENT_ID,
    ],
  )

  // Issue with NO project (project_id = null, but goal has a linked project)
  await provider.query(
    `INSERT INTO issues (id, company_id, identifier, issue_number, title, description, goal_id, project_id, status, priority, assignee_agent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ISSUE_NO_PROJECT_ID,
      COMPANY_ID,
      'ANC-3',
      3,
      'Write integration tests',
      'Cover all adapters',
      GOAL_ID,
      null,
      'in_progress',
      'medium',
      AGENT_ID,
    ],
  )
}

/** Capture the AdapterContext that the executor passes to the adapter. */
function createCapturingAdapter(): {
  adapter: AdapterModule
  getLastContext: () => AdapterContext | undefined
} {
  let lastCtx: AdapterContext | undefined

  const adapter: AdapterModule = {
    type: 'process',
    label: 'Capturing Process',
    execute: vi.fn(async (ctx: AdapterContext) => {
      lastCtx = ctx
      return { exitCode: 0, stdout: 'ok', stderr: '' } satisfies AdapterResult
    }),
  }

  return {
    adapter,
    getLastContext: () => lastCtx,
  }
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

describe('Goal Ancestry', () => {
  it('populates full ancestry chain when task has goal and project', async () => {
    // Ensure only the full-ancestry issue is in_progress for this agent
    await db.query(
      `UPDATE issues SET status = 'backlog' WHERE id IN ($1, $2)`,
      [ISSUE_NO_GOAL_ID, ISSUE_NO_PROJECT_ID],
    )
    await db.query(
      `UPDATE issues SET status = 'in_progress' WHERE id = $1`,
      [ISSUE_FULL_ID],
    )

    const { adapter, getLastContext } = createCapturingAdapter()
    const registry = new AdapterRegistry()
    registry.register(adapter)
    const executor = new HeartbeatExecutor(
      db,
      costTracker,
      observatory,
      registry,
    )

    await executor.execute(AGENT_ID, TriggerType.Manual)

    const ctx = getLastContext()
    expect(ctx).toBeDefined()
    expect(ctx!.ancestry).toBeDefined()
    expect(ctx!.ancestry!.mission).toBe('Build the best AI agent platform')
    expect(ctx!.ancestry!.project).toEqual({
      name: 'Core Engine',
      description: 'Build the orchestration engine',
    })
    expect(ctx!.ancestry!.goal).toEqual({
      name: 'Ship v1.0',
      description: 'Release the first stable version',
    })
    expect(ctx!.ancestry!.task).toEqual({
      title: 'Implement heartbeat executor',
      description: 'Build the core executor logic',
    })
  })

  it('sets goal to null when task has no goal_id', async () => {
    // Activate only the no-goal issue
    await db.query(
      `UPDATE issues SET status = 'backlog' WHERE company_id = $1`,
      [COMPANY_ID],
    )
    await db.query(
      `UPDATE issues SET status = 'in_progress', assignee_agent_id = $1 WHERE id = $2`,
      [AGENT_ID, ISSUE_NO_GOAL_ID],
    )

    const { adapter, getLastContext } = createCapturingAdapter()
    const registry = new AdapterRegistry()
    registry.register(adapter)
    const executor = new HeartbeatExecutor(
      db,
      costTracker,
      observatory,
      registry,
    )

    await executor.execute(AGENT_ID, TriggerType.Manual)

    const ctx = getLastContext()
    expect(ctx).toBeDefined()
    expect(ctx!.ancestry).toBeDefined()
    expect(ctx!.ancestry!.goal).toBeNull()
    // Project should still be resolved from issue's project_id
    expect(ctx!.ancestry!.project).toEqual({
      name: 'Core Engine',
      description: 'Build the orchestration engine',
    })
    expect(ctx!.ancestry!.mission).toBe('Build the best AI agent platform')
  })

  it('resolves project from goal when task has no project_id', async () => {
    // Activate only the no-project issue (has goal_id, project found via goal)
    await db.query(
      `UPDATE issues SET status = 'backlog' WHERE company_id = $1`,
      [COMPANY_ID],
    )
    await db.query(
      `UPDATE issues SET status = 'in_progress', assignee_agent_id = $1 WHERE id = $2`,
      [AGENT_ID, ISSUE_NO_PROJECT_ID],
    )

    const { adapter, getLastContext } = createCapturingAdapter()
    const registry = new AdapterRegistry()
    registry.register(adapter)
    const executor = new HeartbeatExecutor(
      db,
      costTracker,
      observatory,
      registry,
    )

    await executor.execute(AGENT_ID, TriggerType.Manual)

    const ctx = getLastContext()
    expect(ctx).toBeDefined()
    expect(ctx!.ancestry).toBeDefined()
    expect(ctx!.ancestry!.goal).toEqual({
      name: 'Ship v1.0',
      description: 'Release the first stable version',
    })
    // Project resolved via goal_id fallback
    expect(ctx!.ancestry!.project).toEqual({
      name: 'Core Engine',
      description: 'Build the orchestration engine',
    })
  })

  it('returns undefined ancestry when agent has no assigned task', async () => {
    const { adapter, getLastContext } = createCapturingAdapter()
    const registry = new AdapterRegistry()
    registry.register(adapter)
    const executor = new HeartbeatExecutor(
      db,
      costTracker,
      observatory,
      registry,
    )

    await executor.execute(AGENT_NO_TASK_ID, TriggerType.Manual)

    const ctx = getLastContext()
    expect(ctx).toBeDefined()
    expect(ctx!.ancestry).toBeUndefined()
  })
})
