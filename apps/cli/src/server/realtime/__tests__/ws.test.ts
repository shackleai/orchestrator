import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { WebSocketManager } from '../ws.js'

/** Create a simple HTTP server for testing. */
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
  waitForMessage: (index?: number) => Promise<Record<string, unknown>>
}

/**
 * Connect a WebSocket and collect all messages.
 * Messages are buffered so we never miss the welcome message.
 */
function connectClient(
  port: number,
  companyId: string,
): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = []
    const waiters: Array<() => void> = []

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?companyId=${companyId}`,
    )

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>)
      // Wake up any waiters
      for (const w of waiters.splice(0)) w()
    })

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitForMessage: (index = 0) => {
          if (messages.length > index) {
            return Promise.resolve(messages[index])
          }
          return new Promise<Record<string, unknown>>((res) => {
            const check = () => {
              if (messages.length > index) {
                res(messages[index])
              } else {
                waiters.push(check)
              }
            }
            waiters.push(check)
          })
        },
      })
    })

    ws.on('error', reject)
  })
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager
  let server: http.Server
  let port: number
  const clients: WebSocket[] = []

  afterEach(async () => {
    for (const ws of clients) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    clients.length = 0

    manager?.close()

    await new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve())
      } else {
        resolve()
      }
    })
  })

  it('accepts connections and sends welcome message', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    const client = await connectClient(port, 'company-1')
    clients.push(client.ws)

    const msg = await client.waitForMessage(0)
    expect(msg.type).toBe('connected')
    expect(msg.companyId).toBe('company-1')
    expect(msg.payload).toEqual({
      message: 'WebSocket connection established',
    })
  })

  it('broadcasts events only to matching companyId', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    const c1 = await connectClient(port, 'company-1')
    const c2 = await connectClient(port, 'company-2')
    clients.push(c1.ws, c2.ws)

    // Wait for welcome messages
    await c1.waitForMessage(0)
    await c2.waitForMessage(0)

    manager.broadcast('company-1', {
      type: 'heartbeat_start',
      companyId: 'company-1',
      timestamp: new Date().toISOString(),
      payload: { runId: 'run-1', agentId: 'agent-1', trigger: 'cron' },
    })

    // c1 should get the broadcast (index 1 = second message after welcome)
    const received = await c1.waitForMessage(1)
    expect(received.type).toBe('heartbeat_start')

    // c2 should NOT get any more messages beyond welcome
    await new Promise((r) => setTimeout(r, 100))
    expect(c2.messages).toHaveLength(1) // only welcome
  })

  it('tracks connection count', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    expect(manager.getConnectionCount()).toBe(0)

    const c1 = await connectClient(port, 'company-1')
    clients.push(c1.ws)
    await c1.waitForMessage(0) // wait for welcome

    expect(manager.getConnectionCount()).toBe(1)
    expect(manager.getConnectionCount('company-1')).toBe(1)
    expect(manager.getConnectionCount('company-2')).toBe(0)
  })

  it('rejects connections without companyId', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    clients.push(ws)

    await new Promise<void>((resolve) => {
      ws.on('error', () => resolve())
      ws.on('close', () => resolve())
    })

    expect(manager.getConnectionCount()).toBe(0)
  })

  it('rejects connections on non-/ws paths', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/other?companyId=company-1`,
    )
    clients.push(ws)

    await new Promise<void>((resolve) => {
      ws.on('error', () => resolve())
      ws.on('close', () => resolve())
    })

    expect(manager.getConnectionCount()).toBe(0)
  })

  it('cleans up on close', async () => {
    const setup = await createTestServer()
    server = setup.server
    port = setup.port

    manager = new WebSocketManager()
    manager.attach(server)

    const c1 = await connectClient(port, 'company-1')
    clients.push(c1.ws)
    await c1.waitForMessage(0) // wait for welcome

    expect(manager.getConnectionCount()).toBe(1)

    manager.close()

    // Wait for close to propagate
    await new Promise((r) => setTimeout(r, 100))
    expect(manager.getConnectionCount()).toBe(0)
  })
})
