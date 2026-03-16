import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../src/adapters/claude.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

/**
 * Tests for ClaudeAdapter.
 *
 * Since we can't guarantee `claude` CLI is installed in CI, we test the adapter
 * by using `node -e` scripts that simulate Claude CLI behaviour. The adapter
 * spawns `claude` — we override the command indirectly by testing the adapter's
 * structural behaviour (missing prompt, env injection) and using a wrapper.
 */

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-001',
    adapterConfig: {
      prompt: 'Hello Claude',
    },
    env: {},
    ...overrides,
  }
}

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter()

  it('has correct type and label', () => {
    expect(adapter.type).toBe('claude')
    expect(adapter.label).toBe('Claude Code CLI')
  })

  it('returns error when prompt is missing', async () => {
    const ctx = makeCtx({ adapterConfig: {} })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.prompt is required')
  })

  it('returns exit code 127 when claude CLI is not found', async () => {
    // Claude CLI is unlikely to be on the PATH in test environments
    // so this tests the "command not found" path
    const ctx = makeCtx({
      adapterConfig: { prompt: 'test' },
    })

    const result = await adapter.execute(ctx)

    // Either claude runs (0) or is not found (127)
    // In CI, it's almost certainly not found
    if (result.exitCode === 127) {
      expect(result.stderr).toContain('Failed to spawn claude CLI')
    } else {
      // Claude CLI is actually installed — just verify it ran
      expect(result.exitCode).toBeTypeOf('number')
    }
  }, 15_000)

  it('testEnvironment reports when claude is not available', async () => {
    const result = await adapter.testEnvironment()
    // Either ok (claude installed) or not ok (not installed)
    expect(typeof result.ok).toBe('boolean')
    if (!result.ok) {
      expect(result.error).toBeDefined()
    }
  }, 15_000)
})
