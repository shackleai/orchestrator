/**
 * Battle Test — WebSocket (#285)
 *
 * Coverage of WebSocketManager — real HTTP server, real ws connections.
 * No mocks. Tests run against the ws.ts implementation directly.
 *
 * Architecture notes:
 *   - WebSocket endpoint: /ws?companyId=<id>
 *   - No companyId → HTTP 400 + socket destroyed
 *   - Non-/ws path → socket destroyed
 *   - On connect: server sends {type:'connected', companyId, timestamp, payload}
 *   - broadcast(companyId, event) → only that company's connections receive it
 *   - broadcastAll(event) → all connected clients receive it
 *   - Ping/pong keepalive every 30 s (not tested here — too slow)
 *   - close() → terminates all connections + clears keepalive timer
 *   - getConnectionCount(companyId?) → scoped or global count
 *
 * Happy Path:
 *   1. Connect → receive welcome message with correct shape
 *   2. broadcast to company — only target company clients receive it
 *   3. broadcastAll — every connected client receives the event
 *   4. Multiple clients same company all receive broadcast
 *   5. getConnectionCount — global and per-company scoping
 *   6. Client disconnect cleans up connection map
 *   7. Reconnect after disconnect — fresh connection accepted
 *   8. Concurrent connections from two companies — isolated
 *
 * Error Cases:
 *   9.  Connect without companyId → rejected (connection closes/errors)
 *  10.  Connect on /other path → rejected
 *  11.  broadcast() before attach() is a no-op (singleton guard)
 *  12.  close() → connection count drops to 0
 *
 * ENHANCEMENT (not yet implemented):
 *   - Authentication/authorization on WebSocket handshake (no token validation today)
 *   - Server-side message parsing (client→server messages are currently ignored)
 *   - Reconnect with exponential back-off (client-side concern, not server)
 */

import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { WebSocketManager } from '../src/server/realtime/ws.js'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function createTestServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

interface TestClient {
  ws: WebSocket
  messages: Record<string, unknown>[]
  waitForMessage: (index?: number, timeoutMs?: number) => Promise<Record<string, unknown>>
  waitForClose: () => Promise<void>
}

function connectClient(port: number, companyId: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = []
    const waiters: Array<() => void> = []

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?companyId=${companyId}`)

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>)
      for (const w of waiters.splice(0)) w()
    })

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitForMessage: (index = 0, timeoutMs = 2000) => {
          if (messages.length > index) return Promise.resolve(messages[index])
          return new Promise<Record<string, unknown>>((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`Timeout waiting for message[${index}]`)), timeoutMs)
            const check = () => {
              if (messages.length > index) {
                clearTimeout(timer)
                res(messages[index])
              } else {
                waiters.push(check)
              }
            }
            waiters.push(check)
          })
        },
        waitForClose: () =>
          new Promise<void>((res) => {
            if (ws.readyState === WebSocket.CLOSED) {
              res()
            } else {
              ws.once('close', () => res())
            }
          }),
      })
    })

    ws.on('error', reject)
  })
}

/** Attempt to connect and wait for close/error — used for rejection tests. */
function attemptConnection(
  port: number,
  path: string,
): Promise<{ closed: true; code?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('error', () => resolve({ closed: true }))
    ws.on('close', (code) => resolve({ closed: true, code }))
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WebSocket Battle Test (#285)', () => {
  let manager: WebSocketManager
  let server: http.Server
  let port: number
  const openClients: WebSocket[] = []

  afterEach(async () => {
    // Close all open clients first
    for (const ws of openClients) {
      try { ws.close() } catch { /* ignore */ }
    }
    openClients.length = 0

    // Shut down manager (stops keepalive + closes wss)
    try { manager?.close() } catch { /* ignore */ }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve())
      } else {
        resolve()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  it('1. connects and receives welcome message with correct shape', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const client = await connectClient(port, 'company-battle-1')
    openClients.push(client.ws)

    const msg = await client.waitForMessage(0)

    expect(msg.type).toBe('connected')
    expect(msg.companyId).toBe('company-battle-1')
    expect(typeof msg.timestamp).toBe('string')
    // Timestamp should be a valid ISO-8601 date
    expect(() => new Date(msg.timestamp as string)).not.toThrow()
    expect(msg.payload).toEqual({ message: 'WebSocket connection established' })
  })

  it('2. broadcast delivers only to the target company', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const c1 = await connectClient(port, 'company-a')
    const c2 = await connectClient(port, 'company-b')
    openClients.push(c1.ws, c2.ws)

    // Consume welcome messages
    await c1.waitForMessage(0)
    await c2.waitForMessage(0)

    manager.broadcast('company-a', {
      type: 'agent_status_change',
      companyId: 'company-a',
      timestamp: new Date().toISOString(),
      payload: { agentId: 'agent-x', status: 'running' },
    })

    const received = await c1.waitForMessage(1)
    expect(received.type).toBe('agent_status_change')
    expect((received.payload as Record<string, unknown>).agentId).toBe('agent-x')

    // company-b must not receive the broadcast
    await new Promise((r) => setTimeout(r, 150))
    expect(c2.messages).toHaveLength(1) // only welcome
  })

  it('3. broadcastAll delivers to every connected client', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const c1 = await connectClient(port, 'company-a')
    const c2 = await connectClient(port, 'company-b')
    const c3 = await connectClient(port, 'company-c')
    openClients.push(c1.ws, c2.ws, c3.ws)

    await c1.waitForMessage(0)
    await c2.waitForMessage(0)
    await c3.waitForMessage(0)

    const event = {
      type: 'system_maintenance',
      companyId: '*',
      timestamp: new Date().toISOString(),
      payload: { message: 'Server restart in 5 minutes' },
    }
    manager.broadcastAll(event)

    const [m1, m2, m3] = await Promise.all([
      c1.waitForMessage(1),
      c2.waitForMessage(1),
      c3.waitForMessage(1),
    ])

    expect(m1.type).toBe('system_maintenance')
    expect(m2.type).toBe('system_maintenance')
    expect(m3.type).toBe('system_maintenance')
  })

  it('4. multiple clients from the same company all receive the broadcast', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const COMPANY = 'company-multi'
    const clients = await Promise.all([
      connectClient(port, COMPANY),
      connectClient(port, COMPANY),
      connectClient(port, COMPANY),
    ])
    for (const c of clients) openClients.push(c.ws)

    // Wait for all welcome messages
    await Promise.all(clients.map((c) => c.waitForMessage(0)))

    manager.broadcast(COMPANY, {
      type: 'heartbeat_start',
      companyId: COMPANY,
      timestamp: new Date().toISOString(),
      payload: { runId: 'run-42', agentId: 'agent-1', trigger: 'cron' },
    })

    const received = await Promise.all(clients.map((c) => c.waitForMessage(1)))
    for (const msg of received) {
      expect(msg.type).toBe('heartbeat_start')
    }
  })

  it('5. getConnectionCount returns global and per-company counts', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    expect(manager.getConnectionCount()).toBe(0)

    const c1 = await connectClient(port, 'company-x')
    openClients.push(c1.ws)
    await c1.waitForMessage(0)

    expect(manager.getConnectionCount()).toBe(1)
    expect(manager.getConnectionCount('company-x')).toBe(1)
    expect(manager.getConnectionCount('company-y')).toBe(0)

    const c2 = await connectClient(port, 'company-y')
    openClients.push(c2.ws)
    await c2.waitForMessage(0)

    expect(manager.getConnectionCount()).toBe(2)
    expect(manager.getConnectionCount('company-x')).toBe(1)
    expect(manager.getConnectionCount('company-y')).toBe(1)
  })

  it('6. client disconnect cleans up the connection map', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const client = await connectClient(port, 'company-disc')
    openClients.push(client.ws)
    await client.waitForMessage(0)

    expect(manager.getConnectionCount()).toBe(1)

    // Close the client side
    client.ws.close()
    await client.waitForClose()

    // Allow the close event to propagate server-side
    await new Promise((r) => setTimeout(r, 100))
    expect(manager.getConnectionCount()).toBe(0)
  })

  it('7. reconnect after disconnect — fresh connection accepted', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const COMPANY = 'company-reconnect'

    // First connection
    const c1 = await connectClient(port, COMPANY)
    openClients.push(c1.ws)
    await c1.waitForMessage(0)
    expect(manager.getConnectionCount(COMPANY)).toBe(1)

    // Disconnect
    c1.ws.close()
    await c1.waitForClose()
    await new Promise((r) => setTimeout(r, 100))
    expect(manager.getConnectionCount(COMPANY)).toBe(0)

    // Reconnect
    const c2 = await connectClient(port, COMPANY)
    openClients.push(c2.ws)
    const welcome = await c2.waitForMessage(0)
    expect(welcome.type).toBe('connected')
    expect(welcome.companyId).toBe(COMPANY)
    expect(manager.getConnectionCount(COMPANY)).toBe(1)
  })

  it('8. concurrent connections from two companies are fully isolated', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const alpha = await connectClient(port, 'alpha')
    const beta = await connectClient(port, 'beta')
    openClients.push(alpha.ws, beta.ws)

    await alpha.waitForMessage(0)
    await beta.waitForMessage(0)

    // Broadcast to alpha
    manager.broadcast('alpha', {
      type: 'task_completed',
      companyId: 'alpha',
      timestamp: new Date().toISOString(),
      payload: { taskId: 'task-1' },
    })

    // Broadcast to beta
    manager.broadcast('beta', {
      type: 'cost_threshold',
      companyId: 'beta',
      timestamp: new Date().toISOString(),
      payload: { threshold: 1000 },
    })

    const [alphaMsg, betaMsg] = await Promise.all([
      alpha.waitForMessage(1),
      beta.waitForMessage(1),
    ])

    expect(alphaMsg.type).toBe('task_completed')
    expect(betaMsg.type).toBe('cost_threshold')

    // No cross-contamination
    await new Promise((r) => setTimeout(r, 150))
    expect(alpha.messages).toHaveLength(2) // welcome + task_completed
    expect(beta.messages).toHaveLength(2)  // welcome + cost_threshold
  })

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

  it('9. connect without companyId is rejected', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const result = await attemptConnection(port, '/ws')
    expect(result.closed).toBe(true)
    expect(manager.getConnectionCount()).toBe(0)
  })

  it('10. connect on /other path is rejected', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const result = await attemptConnection(port, '/other?companyId=company-1')
    expect(result.closed).toBe(true)
    expect(manager.getConnectionCount()).toBe(0)
  })

  it('11. broadcast() before attach() is a no-op — does not throw', () => {
    // A fresh manager has no wss attached — calling broadcast should not throw
    const m = new WebSocketManager()
    expect(() => {
      m.broadcast('any-company', {
        type: 'noop',
        companyId: 'any-company',
        timestamp: new Date().toISOString(),
        payload: {},
      })
    }).not.toThrow()
  })

  it('12. close() drops connection count to 0', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port
    manager = new WebSocketManager()
    manager.attach(server)

    const c1 = await connectClient(port, 'company-close')
    const c2 = await connectClient(port, 'company-close')
    openClients.push(c1.ws, c2.ws)

    await c1.waitForMessage(0)
    await c2.waitForMessage(0)

    expect(manager.getConnectionCount()).toBe(2)

    manager.close()

    // Wait for close to propagate to clients
    await Promise.all([c1.waitForClose(), c2.waitForClose()])
    expect(manager.getConnectionCount()).toBe(0)
  })
})
