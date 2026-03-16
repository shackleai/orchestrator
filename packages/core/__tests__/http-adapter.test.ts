import http from 'node:http'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HttpAdapter } from '../src/adapters/http.js'
import type { AdapterContext } from '../src/adapters/adapter.js'

/** Helper to create a minimal AdapterContext. */
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

/** Start a local HTTP server that echoes request details back. */
function createEchoServer(): {
  server: http.Server
  url: string
  start: () => Promise<string>
  stop: () => Promise<void>
} {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const path = req.url ?? '/'

      if (path === '/error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
        return
      }

      if (path === '/shackle-result') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            __shackleai_result__: {
              sessionState: 'session-abc',
              usage: {
                inputTokens: 100,
                outputTokens: 200,
                costCents: 5,
                model: 'gpt-4o',
                provider: 'openai',
              },
            },
          }),
        )
        return
      }

      if (path === '/slow') {
        // Don't respond — let it timeout
        return
      }

      // Default: echo back request info
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          method: req.method,
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        }),
      )
    })
  })

  let url = ''

  return {
    server,
    get url() {
      return url
    },
    start: () =>
      new Promise<string>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          if (addr && typeof addr === 'object') {
            url = `http://127.0.0.1:${addr.port}`
          }
          resolve(url)
        })
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

describe('HttpAdapter', () => {
  const adapter = new HttpAdapter()
  let echo: ReturnType<typeof createEchoServer>

  beforeAll(async () => {
    echo = createEchoServer()
    await echo.start()
  })

  afterAll(async () => {
    await echo.stop()
  })

  it('has correct type and label', () => {
    expect(adapter.type).toBe('http')
    expect(adapter.label).toBe('HTTP Webhook')
  })

  it('returns error when URL is missing', async () => {
    const result = await adapter.execute(makeCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('adapterConfig.url is required')
  })

  it('sends POST with correct JSON payload', async () => {
    const ctx = makeCtx({
      agentId: 'agent-post',
      companyId: 'company-post',
      heartbeatRunId: 'run-post',
      task: 'my-task',
      adapterConfig: { url: echo.url },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)

    const response = JSON.parse(result.stdout) as {
      method: string
      body: Record<string, unknown>
    }
    expect(response.method).toBe('POST')
    expect(response.body.agentId).toBe('agent-post')
    expect(response.body.companyId).toBe('company-post')
    expect(response.body.heartbeatRunId).toBe('run-post')
    expect(response.body.task).toBe('my-task')
  })

  it('sends custom headers and auth token', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        url: echo.url,
        headers: { 'X-Custom': 'custom-value' },
        authToken: 'my-secret-token',
      },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)

    const response = JSON.parse(result.stdout) as {
      headers: Record<string, string>
    }
    expect(response.headers['x-custom']).toBe('custom-value')
    expect(response.headers['authorization']).toBe('Bearer my-secret-token')
  })

  it('handles non-2xx responses', async () => {
    const ctx = makeCtx({
      adapterConfig: { url: `${echo.url}/error` },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('500')
  })

  it('parses __shackleai_result__ from response', async () => {
    const ctx = makeCtx({
      adapterConfig: { url: `${echo.url}/shackle-result` },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(0)
    expect(result.sessionState).toBe('session-abc')
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      costCents: 5,
      model: 'gpt-4o',
      provider: 'openai',
    })
  })

  it('enforces timeout', async () => {
    const ctx = makeCtx({
      adapterConfig: {
        url: `${echo.url}/slow`,
        timeout: 1,
      },
    })

    const start = Date.now()
    const result = await adapter.execute(ctx)
    const elapsed = Date.now() - start

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timed out')
    expect(elapsed).toBeLessThan(5000)
  }, 10_000)

  it('handles connection refused', async () => {
    const ctx = makeCtx({
      adapterConfig: { url: 'http://127.0.0.1:1' },
    })

    const result = await adapter.execute(ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('HTTP request failed')
  })

  it('testEnvironment returns ok', async () => {
    const result = await adapter.testEnvironment()
    expect(result.ok).toBe(true)
  })
})
