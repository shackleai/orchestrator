import { describe, it, expect } from 'vitest'
import { McpAdapter } from '../src/adapters/mcp.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-001',
    companyId: 'company-001',
    heartbeatRunId: 'run-001',
    adapterConfig: {},
    env: {},
    ...overrides,
  }
}

describe('McpAdapter', () => {
  const adapter = new McpAdapter()

  it('has correct type and label', () => {
    expect(adapter.type).toBe('mcp')
    expect(adapter.label).toBe('MCP Server Tool')
  })

  it('returns error when URL is missing', async () => {
    const ctx = makeCtx({ adapterConfig: {} })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.url is required')
  })

  it('returns error when toolName is missing', async () => {
    const ctx = makeCtx({
      adapterConfig: { url: 'http://localhost:3000/mcp' },
    })
    const result = await adapter.execute(ctx)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.toolName is required')
  })

  it('returns error when MCP server is unreachable', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        url: 'http://127.0.0.1:1/mcp',
        toolName: 'test-tool',
        // Keep timeout short so callTool races don't add extra delay, but the
        // real bottleneck is the TCP connect() call which has no timeout in the
        // adapter. On Windows, connection refusal to port 1 can take >15s, so
        // we allow 30s at the Vitest level.
        timeout: 2,
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('MCP tool call failed')
  }, 30_000)

  it('testEnvironment checks for SDK availability', async () => {
    const result = await adapter.testEnvironment()
    // SDK is installed in this project, so should be ok
    expect(result.ok).toBe(true)
  })
})
