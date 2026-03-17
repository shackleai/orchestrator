import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { TriggerType } from '@shackleai/shared'
import { CostTracker } from '../src/cost-tracker.js'
import { Observatory } from '../src/observatory.js'
import { AdapterRegistry } from '../src/adapters/index.js'
import type { AdapterModule, AdapterResult } from '../src/adapters/index.js'
import { HeartbeatExecutor } from '../src/runner/executor.js'

let db: PGliteProvider
let costTracker: CostTracker
let observatory: Observatory

const COMPANY_ID = '00000000-0000-4000-a000-000000000101'
const AGENT_ID = '00000000-0000-4000-a000-000000000110'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'ToolCall Co', 'active', 'TCC', 0, 100000, 0],
  )

  await provider.query(
    `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      AGENT_ID,
      COMPANY_ID,
      'tool-bot',
      'process',
      JSON.stringify({ command: 'echo', args: ['hello'] }),
      10000,
      0,
    ],
  )
}

function createMockAdapter(overrides: Partial<AdapterResult> = {}): AdapterModule {
  return {
    type: 'process',
    label: 'Mock Process',
    execute: vi.fn(async () => ({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      ...overrides,
    })),
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

describe('Tool call tracing', () => {
  it('inserts tool_calls rows when adapter returns toolCalls', async () => {
    const mockAdapter = createMockAdapter({
      toolCalls: [
        {
          toolName: 'read_file',
          toolInput: { path: '/src/index.ts' },
          toolOutput: 'file contents here',
          durationMs: 150,
          status: 'success',
        },
        {
          toolName: 'write_file',
          toolInput: { path: '/src/out.ts', content: 'new content' },
          toolOutput: 'written',
          durationMs: 200,
          status: 'success',
        },
      ],
    })

    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    const result = await executor.execute(AGENT_ID, TriggerType.Manual)
    expect(result.exitCode).toBe(0)

    // Verify tool_calls rows were inserted
    const rows = await db.query<{
      tool_name: string
      tool_input: Record<string, unknown> | null
      tool_output: string | null
      duration_ms: number | null
      status: string
      agent_id: string
      company_id: string
    }>(
      `SELECT tool_name, tool_input, tool_output, duration_ms, status, agent_id, company_id
       FROM tool_calls WHERE agent_id = $1 ORDER BY created_at ASC`,
      [AGENT_ID],
    )

    expect(rows.rows).toHaveLength(2)

    expect(rows.rows[0].tool_name).toBe('read_file')
    expect(rows.rows[0].tool_input).toEqual({ path: '/src/index.ts' })
    expect(rows.rows[0].tool_output).toBe('file contents here')
    expect(rows.rows[0].duration_ms).toBe(150)
    expect(rows.rows[0].status).toBe('success')
    expect(rows.rows[0].agent_id).toBe(AGENT_ID)
    expect(rows.rows[0].company_id).toBe(COMPANY_ID)

    expect(rows.rows[1].tool_name).toBe('write_file')
    expect(rows.rows[1].duration_ms).toBe(200)
  })

  it('inserts no rows when adapter returns no toolCalls (backward compatible)', async () => {
    // Create a separate agent to avoid interference
    const AGENT_NO_TC = '00000000-0000-4000-a000-000000000111'
    await db.query(
      `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        AGENT_NO_TC,
        COMPANY_ID,
        'no-tool-bot',
        'process',
        JSON.stringify({ command: 'echo' }),
        10000,
        0,
      ],
    )

    const mockAdapter = createMockAdapter() // no toolCalls
    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_NO_TC, TriggerType.Manual)

    const rows = await db.query(
      'SELECT * FROM tool_calls WHERE agent_id = $1',
      [AGENT_NO_TC],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('handles tool calls with error status', async () => {
    const AGENT_ERR_TC = '00000000-0000-4000-a000-000000000112'
    await db.query(
      `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        AGENT_ERR_TC,
        COMPANY_ID,
        'err-tool-bot',
        'process',
        JSON.stringify({ command: 'echo' }),
        10000,
        0,
      ],
    )

    const mockAdapter = createMockAdapter({
      toolCalls: [
        {
          toolName: 'bash',
          toolInput: { command: 'rm -rf /' },
          toolOutput: 'permission denied',
          durationMs: 10,
          status: 'error',
        },
      ],
    })

    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_ERR_TC, TriggerType.Manual)

    const rows = await db.query<{ tool_name: string; status: string }>(
      'SELECT tool_name, status FROM tool_calls WHERE agent_id = $1',
      [AGENT_ERR_TC],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].status).toBe('error')
  })

  it('handles tool calls with minimal fields (optional fields null)', async () => {
    const AGENT_MIN_TC = '00000000-0000-4000-a000-000000000113'
    await db.query(
      `INSERT INTO agents (id, company_id, name, adapter_type, adapter_config, budget_monthly_cents, spent_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        AGENT_MIN_TC,
        COMPANY_ID,
        'min-tool-bot',
        'process',
        JSON.stringify({ command: 'echo' }),
        10000,
        0,
      ],
    )

    const mockAdapter = createMockAdapter({
      toolCalls: [
        {
          toolName: 'think',
          // no toolInput, toolOutput, durationMs, or status
        },
      ],
    })

    const registry = new AdapterRegistry()
    registry.register(mockAdapter)
    const executor = new HeartbeatExecutor(db, costTracker, observatory, registry)

    await executor.execute(AGENT_MIN_TC, TriggerType.Manual)

    const rows = await db.query<{
      tool_name: string
      tool_input: Record<string, unknown> | null
      tool_output: string | null
      duration_ms: number | null
      status: string
    }>(
      'SELECT tool_name, tool_input, tool_output, duration_ms, status FROM tool_calls WHERE agent_id = $1',
      [AGENT_MIN_TC],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].tool_name).toBe('think')
    expect(rows.rows[0].tool_input).toBeNull()
    expect(rows.rows[0].tool_output).toBeNull()
    expect(rows.rows[0].duration_ms).toBeNull()
    expect(rows.rows[0].status).toBe('success') // default
  })
})
