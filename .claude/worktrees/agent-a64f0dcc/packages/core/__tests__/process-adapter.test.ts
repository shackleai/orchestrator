import { describe, it, expect } from 'vitest'
import { ProcessAdapter } from '../src/adapters/process.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-001',
    adapterConfig: {
      command: 'node',
      args: ['-e', "process.stdout.write('hello')"],
    },
    env: {},
    ...overrides,
  }
}

describe('ProcessAdapter', () => {
  const adapter = new ProcessAdapter()

  it('has correct type and label', () => {
    expect(adapter.type).toBe('process')
    expect(adapter.label).toBe('Child Process')
  })

  it('spawns a command and captures stdout', async () => {
    const result = await adapter.execute(makeCtx())

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('')
  })

  it('captures stderr output', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        command: 'node',
        args: ['-e', "process.stderr.write('err-msg')"],
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('err-msg')
  })

  it('returns non-zero exit code on failure', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        command: 'node',
        args: ['-e', 'process.exit(42)'],
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(42)
  })

  it('returns exit code 127 when command does not exist', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        command: 'shackleai_nonexistent_command_xyz',
        args: [],
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toContain('Failed to spawn process')
  })

  it('returns error when command is missing from adapterConfig', async () => {
    const ctx = makeCtx({ adapterConfig: {} })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.command is required')
  })

  it('injects SHACKLEAI_* env vars', async () => {
    const ctx = makeCtx({
      agentId: 'agent-env-test',
      heartbeatRunId: 'run-env-test',
      task: 'task-env-test',
      env: { SHACKLEAI_API_KEY: 'sk_test_key' },
      adapterConfig: {
        command: 'node',
        args: [
          '-e',
          "const e = process.env; process.stdout.write([e.SHACKLEAI_RUN_ID, e.SHACKLEAI_AGENT_ID, e.SHACKLEAI_TASK_ID, e.SHACKLEAI_API_KEY].join(','))",
        ],
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'run-env-test,agent-env-test,task-env-test,sk_test_key',
    )
  })

  it('enforces timeout and kills the process', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        timeout: 1, // 1 second
      },
    })

    const start = Date.now()
    const result = await adapter.execute(ctx)
    const elapsed = Date.now() - start

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timeout')
    // Should complete in roughly 1-7 seconds (timeout + kill grace)
    expect(elapsed).toBeLessThan(15_000)
  }, 20_000)

  it('testEnvironment returns ok', async () => {
    const result = await adapter.testEnvironment()
    expect(result.ok).toBe(true)
  })
})
