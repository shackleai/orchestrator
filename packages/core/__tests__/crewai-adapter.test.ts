import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CrewAIAdapter } from '../src/adapters/crewai.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

// Create a temp directory for test entrypoint scripts
const TEMP_DIR = join(tmpdir(), 'shackleai-crewai-test-' + Date.now())
const ENTRYPOINT = join(TEMP_DIR, 'crew.js')

beforeAll(() => {
  mkdirSync(TEMP_DIR, { recursive: true })
  // Default entrypoint: echoes task payload back and emits a result block
  writeFileSync(
    ENTRYPOINT,
    `
const args = process.argv.slice(2);
const taskIdx = args.indexOf('--task');
const payload = taskIdx >= 0 ? args[taskIdx + 1] : '{}';
process.stdout.write('CrewAI running...\\n');
process.stdout.write('__shackleai_result__' + JSON.stringify({
  inputTokens: 1500,
  outputTokens: 800,
  costCents: 2.5,
  model: 'gpt-4',
  provider: 'openai',
  sessionState: 'session-abc-123'
}) + '__shackleai_result__\\n');
process.stdout.write('Done. Payload: ' + payload + '\\n');
`,
  )
})

afterAll(() => {
  try {
    unlinkSync(ENTRYPOINT)
  } catch {
    // ignore
  }
})

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-crew-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-crew-001',
    adapterConfig: {
      pythonPath: 'node',
      entrypoint: ENTRYPOINT,
    },
    env: {},
    ...overrides,
  }
}

describe('CrewAIAdapter', () => {
  const adapter = new CrewAIAdapter()

  it('has correct type and label', () => {
    expect(adapter.type).toBe('crewai')
    expect(adapter.label).toBe('CrewAI Crew')
  })

  it('spawns subprocess with task payload and captures stdout', async () => {
    const ctx = makeCtx({ task: 'research AI trends' })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('CrewAI running...')
    expect(result.stdout).toContain('Done. Payload:')
    // Verify payload contains the task
    expect(result.stdout).toContain('research AI trends')
  })

  it('parses aggregate token usage from __shackleai_result__ block', async () => {
    const result = await adapter.execute(makeCtx())

    expect(result.usage).toBeDefined()
    expect(result.usage?.inputTokens).toBe(1500)
    expect(result.usage?.outputTokens).toBe(800)
    expect(result.usage?.costCents).toBe(2.5)
    expect(result.usage?.model).toBe('gpt-4')
    expect(result.usage?.provider).toBe('openai')
  })

  it('extracts session state from result block', async () => {
    const result = await adapter.execute(makeCtx())

    expect(result.sessionState).toBe('session-abc-123')
  })

  it('passes session state round-trip', async () => {
    const ctx = makeCtx({ sessionState: 'prev-session-state' })
    const result = await adapter.execute(ctx)

    // The entrypoint receives sessionState in the payload
    expect(result.stdout).toContain('prev-session-state')
    expect(result.exitCode).toBe(0)
  })

  it('injects SHACKLEAI_* env vars', async () => {
    const envScript = join(TEMP_DIR, 'env-check.js')
    writeFileSync(
      envScript,
      `
const e = process.env;
process.stdout.write([
  e.SHACKLEAI_RUN_ID,
  e.SHACKLEAI_AGENT_ID,
  e.SHACKLEAI_TASK_ID,
  e.SHACKLEAI_API_URL
].join(','));
`,
    )

    const ctx = makeCtx({
      agentId: 'agent-env',
      heartbeatRunId: 'run-env',
      task: 'task-env',
      env: { SHACKLEAI_API_URL: 'https://api.shackle.ai' },
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: envScript,
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'run-env,agent-env,task-env,https://api.shackle.ai',
    )

    unlinkSync(envScript)
  })

  it('enforces timeout and kills runaway crew', async () => {
    const hangScript = join(TEMP_DIR, 'hang.js')
    writeFileSync(hangScript, 'setTimeout(() => {}, 120000);')

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: hangScript,
        timeout: 1, // 1 second
      },
    })

    const start = Date.now()
    const result = await adapter.execute(ctx)
    const elapsed = Date.now() - start

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timeout')
    // Should finish within timeout + kill grace (1s + 10s + buffer)
    expect(elapsed).toBeLessThan(20_000)

    unlinkSync(hangScript)
  }, 30_000)

  it('returns error when entrypoint is missing from config', async () => {
    const ctx = makeCtx({
      adapterConfig: { pythonPath: 'node' },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.entrypoint is required')
  })

  it('returns error when entrypoint file does not exist', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: '/nonexistent/path/crew.py',
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Entrypoint file not found')
  })

  it('truncates large stdout beyond 500 lines', async () => {
    const verboseScript = join(TEMP_DIR, 'verbose.js')
    writeFileSync(
      verboseScript,
      `
for (let i = 0; i < 1000; i++) {
  console.log('Line ' + i + ': crew member processing step ' + i);
}
`,
    )

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: verboseScript,
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('truncated')
    expect(result.stdout).toContain('last 500')
    // Should contain the last lines
    expect(result.stdout).toContain('Line 999')
    // Should NOT contain early lines
    expect(result.stdout).not.toContain('Line 0:')

    unlinkSync(verboseScript)
  })

  it('passes crewConfig arg when specified', async () => {
    const argScript = join(TEMP_DIR, 'args-check.js')
    writeFileSync(
      argScript,
      `
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify(args));
`,
    )

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: argScript,
        crewConfig: '/path/to/crew.yaml',
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    const args = JSON.parse(result.stdout) as string[]
    expect(args).toContain('--config')
    expect(args).toContain('/path/to/crew.yaml')

    unlinkSync(argScript)
  })

  it('returns non-zero exit code on failure', async () => {
    const failScript = join(TEMP_DIR, 'fail.js')
    writeFileSync(failScript, 'process.exit(42);')

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: failScript,
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(42)

    unlinkSync(failScript)
  })

  it('testEnvironment checks for python and crewai', async () => {
    // testEnvironment uses python3 by default — on most CI/test envs
    // this will either work or fail gracefully
    const result = await adapter.testEnvironment()
    // We just verify it returns a valid shape
    expect(typeof result.ok).toBe('boolean')
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
    }
  }, 20_000)

  it('handles spawn error for invalid python path', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'shackleai_nonexistent_python_xyz',
        entrypoint: ENTRYPOINT,
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toContain('Failed to spawn process')
  })
})
