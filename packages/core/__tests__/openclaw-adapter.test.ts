import { describe, it, expect } from 'vitest'
import { OpenClawAdapter } from '../src/adapters/openclaw.js'
import type { AdapterContext } from '../src/adapters/adapter.js'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Create a temporary Python-like entrypoint that is actually a node script. */
function createTempScript(name: string, content: string): string {
  const dir = join(tmpdir(), 'shackleai-openclaw-tests')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, content, 'utf-8')
  return path
}

/**
 * The OpenClawAdapter spawns `pythonPath entrypoint --task ... --session ...`.
 * For testing, we override pythonPath to `node` and write JS scripts as
 * entrypoints. The adapter does not care whether Python or Node runs the file.
 */
function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-001',
    adapterConfig: {
      pythonPath: 'node',
      entrypoint: '', // must be set per test
    },
    env: {},
    ...overrides,
  }
}

describe('OpenClawAdapter', () => {
  const adapter = new OpenClawAdapter()

  it('has correct type and label', () => {
    expect(adapter.type).toBe('openclaw')
    expect(adapter.label).toBe('OpenClaw Agent')
  })

  it('uses CLI mode when entrypoint is not provided', async () => {
    // Without entrypoint, adapter should attempt CLI mode (npx openclaw agent)
    // This will fail in CI (no OpenClaw installed) but should not error with "entrypoint required"
    const ctx = makeCtx({ adapterConfig: { agent: 'main' } })
    const result = await adapter.execute(ctx)

    // CLI mode attempted — either works (exit 0) or fails to spawn (exit 127)
    // but should NOT return "entrypoint is required"
    expect(result.stderr).not.toContain('adapterConfig.entrypoint is required')
  }, 30_000)

  it('returns error when entrypoint file does not exist', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: '/nonexistent/path/agent.py',
      },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Entrypoint not found')
  })

  it('spawns subprocess and captures stdout', async () => {
    const script = createTempScript(
      'simple-agent.js',
      `process.stdout.write('hello from openclaw');`,
    )

    const ctx = makeCtx({
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello from openclaw')

    unlinkSync(script)
  })

  it('injects SHACKLEAI_* env vars', async () => {
    const script = createTempScript(
      'env-agent.js',
      `const e = process.env;
process.stdout.write([
  e.SHACKLEAI_RUN_ID,
  e.SHACKLEAI_AGENT_ID,
  e.SHACKLEAI_TASK_ID,
  e.SHACKLEAI_API_URL,
].join(','));`,
    )

    const ctx = makeCtx({
      agentId: 'agent-env',
      heartbeatRunId: 'run-env',
      task: 'task-env',
      env: { SHACKLEAI_API_URL: 'https://api.shackleai.com' },
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(
      'run-env,agent-env,task-env,https://api.shackleai.com',
    )

    unlinkSync(script)
  })

  it('passes task payload as --task JSON argument', async () => {
    const script = createTempScript(
      'task-agent.js',
      `const idx = process.argv.indexOf('--task');
const payload = JSON.parse(process.argv[idx + 1]);
process.stdout.write(payload.agentId + ':' + payload.task);`,
    )

    const ctx = makeCtx({
      agentId: 'agent-task',
      task: 'analyze data',
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('agent-task:analyze data')

    unlinkSync(script)
  })

  it('parses __shackleai_result__ block for token usage', async () => {
    const resultJson = JSON.stringify({
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        costCents: 0.5,
        model: 'gpt-4',
        provider: 'openai',
      },
    })
    const script = createTempScript(
      'usage-agent.js',
      `process.stdout.write('some output\\n__shackleai_result__${resultJson}__shackleai_result__\\nmore output');`,
    )

    const ctx = makeCtx({
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.usage).toBeDefined()
    expect(result.usage!.inputTokens).toBe(100)
    expect(result.usage!.outputTokens).toBe(50)
    expect(result.usage!.costCents).toBe(0.5)
    expect(result.usage!.model).toBe('gpt-4')
    expect(result.usage!.provider).toBe('openai')

    unlinkSync(script)
  })

  it('parses session state from __shackleai_result__ block', async () => {
    const resultJson = JSON.stringify({
      session_id_after: 'session-xyz-123',
    })
    const script = createTempScript(
      'session-agent.js',
      `process.stdout.write('__shackleai_result__${resultJson}__shackleai_result__');`,
    )

    const ctx = makeCtx({
      sessionState: 'session-previous',
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.sessionState).toBe('session-xyz-123')

    unlinkSync(script)
  })

  it('passes session state through to subprocess', async () => {
    const script = createTempScript(
      'session-check.js',
      `const idx = process.argv.indexOf('--session');
process.stdout.write('session:' + process.argv[idx + 1]);`,
    )

    const ctx = makeCtx({
      sessionState: 'prev-session-abc',
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('session:prev-session-abc')

    unlinkSync(script)
  })

  it('enforces timeout and kills the process', async () => {
    const script = createTempScript(
      'slow-agent.js',
      `setTimeout(() => {}, 60000);`,
    )

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'node',
        entrypoint: script,
        timeout: 1, // 1 second
      },
    })

    const start = Date.now()
    const result = await adapter.execute(ctx)
    const elapsed = Date.now() - start

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timeout')
    // Should complete in roughly 1-12 seconds (timeout + 10s kill grace)
    expect(elapsed).toBeLessThan(20_000)

    unlinkSync(script)
  }, 25_000)

  it('truncates stdout at 10 MB limit', async () => {
    // Generate >10MB of output. Write in a loop to exceed the limit.
    const script = createTempScript(
      'big-agent.js',
      `const chunk = 'x'.repeat(1024 * 1024); // 1MB
for (let i = 0; i < 12; i++) { process.stdout.write(chunk); }`,
    )

    const ctx = makeCtx({
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[WARNING] stdout truncated')
    // Actual stdout should be roughly 10MB, not 12MB
    expect(result.stdout.length).toBeLessThanOrEqual(10 * 1024 * 1024 + 200)

    unlinkSync(script)
  }, 15_000)

  it('returns non-zero exit code on failure', async () => {
    const script = createTempScript(
      'fail-agent.js',
      `process.exit(42);`,
    )

    const ctx = makeCtx({
      adapterConfig: { pythonPath: 'node', entrypoint: script },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(42)

    unlinkSync(script)
  })

  it('returns exit code 127 when pythonPath command does not exist', async () => {
    const script = createTempScript('dummy.js', '')

    const ctx = makeCtx({
      adapterConfig: {
        pythonPath: 'shackleai_nonexistent_python_xyz',
        entrypoint: script,
      },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(127)
    expect(result.stderr).toContain('Failed to spawn OpenClaw process')

    unlinkSync(script)
  })

  it('testEnvironment detects available runtime', async () => {
    // testEnvironment checks for python3/python — we can't guarantee Python
    // is installed, so we just verify it returns a valid shape
    const result = await adapter.testEnvironment()
    expect(typeof result.ok).toBe('boolean')
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
    }
  })
})
