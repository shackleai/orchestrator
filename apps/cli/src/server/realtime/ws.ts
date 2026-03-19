/**
 * WebSocketManager — manages WebSocket connections for real-time event streaming.
 *
 * Clients connect to /ws, authenticate with a Bearer token, and subscribe to a
 * company channel. The server broadcasts events (heartbeat lifecycle, agent
 * status changes, tool calls, cost events, task updates) to all clients
 * subscribed to the relevant company.
 *
 * Features:
 * - Company-scoped channels (clients only receive events for their company)
 * - Bearer token authentication on subscribe (reuses API key validation)
 * - Automatic cleanup on disconnect
 * - Heartbeat ping/pong for keepalive (30s interval, 10s timeout)
 */

import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { WebSocket as WsWebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import type { DatabaseProvider } from '@shackleai/db'
import type {
  WebSocketEvent,
  WebSocketEventType,
  WebSocketClientMessage,
  AgentApiKey,
} from '@shackleai/shared'
import { AgentApiKeyStatus } from '@shackleai/shared'

/** Internal tracked connection with metadata. */
interface TrackedConnection {
  ws: WsWebSocket
  companyId: string | null
  alive: boolean
}

export class WebSocketManager {
  private wss: WebSocketServer
  private connections = new Set<TrackedConnection>()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private db: DatabaseProvider

  /** Ping interval in ms (30s). */
  private static readonly PING_INTERVAL_MS = 30_000
  /** If no pong within this time, terminate (10s). */
  private static readonly PONG_TIMEOUT_MS = 10_000

  constructor(db: DatabaseProvider) {
    this.db = db
    // Create a standalone WebSocket server (no HTTP server -- we handle upgrade manually)
    this.wss = new WebSocketServer({ noServer: true })
    this.startPingInterval()
  }

  /**
   * Handle an HTTP upgrade request. Called from the Node.js HTTP server's
   * 'upgrade' event when the path matches /ws.
   */
  handleUpgrade(request: IncomingMessage, socket: import('node:net').Socket, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.onConnection(ws)
    })
  }

  /**
   * Broadcast an event to all clients subscribed to the given company.
   * Non-blocking -- send failures are silently ignored.
   */
  broadcast(companyId: string, type: WebSocketEventType, payload: Record<string, unknown>): void {
    const event: WebSocketEvent = {
      type,
      companyId,
      timestamp: new Date().toISOString(),
      payload,
    }

    const data = JSON.stringify(event)

    for (const conn of this.connections) {
      if (conn.companyId === companyId && conn.ws.readyState === 1 /* OPEN */) {
        try {
          conn.ws.send(data)
        } catch {
          // Best-effort -- don't let a single bad connection break broadcast
        }
      }
    }
  }

  /**
   * Get the number of currently connected clients, optionally filtered by company.
   */
  getConnectionCount(companyId?: string): number {
    if (!companyId) return this.connections.size
    let count = 0
    for (const conn of this.connections) {
      if (conn.companyId === companyId) count++
    }
    return count
  }

  /**
   * Gracefully shut down: close all connections and stop the ping interval.
   */
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    for (const conn of this.connections) {
      try {
        conn.ws.close(1001, 'Server shutting down')
      } catch {
        // Ignore close errors
      }
    }
    this.connections.clear()
    this.wss.close()
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private onConnection(ws: WsWebSocket): void {
    const conn: TrackedConnection = {
      ws,
      companyId: null,
      alive: true,
    }

    this.connections.add(conn)

    ws.on('pong', () => {
      conn.alive = true
    })

    ws.on('message', (raw: Buffer | string) => {
      this.handleMessage(conn, raw).catch((err: unknown) => {
        console.error('[WebSocketManager] Message handler error:', err)
      })
    })

    ws.on('close', () => {
      this.connections.delete(conn)
    })

    ws.on('error', () => {
      this.connections.delete(conn)
    })

    // Send a welcome message so the client knows the connection is established
    try {
      ws.send(JSON.stringify({ type: 'connected', message: 'Authenticate with { action: "subscribe", companyId, token }' }))
    } catch {
      // Ignore send errors on fresh connection
    }
  }

  private async handleMessage(conn: TrackedConnection, raw: Buffer | string): Promise<void> {
    let msg: WebSocketClientMessage

    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as WebSocketClientMessage
    } catch {
      this.sendError(conn.ws, 'Invalid JSON')
      return
    }

    switch (msg.action) {
      case 'subscribe':
        await this.handleSubscribe(conn, msg.companyId, msg.token)
        break

      case 'unsubscribe':
        conn.companyId = null
        this.sendJson(conn.ws, { type: 'unsubscribed' })
        break

      case 'ping':
        this.sendJson(conn.ws, { type: 'pong' })
        break

      default:
        this.sendError(conn.ws, `Unknown action: ${(msg as { action: string }).action}`)
    }
  }

  private async handleSubscribe(conn: TrackedConnection, companyId: string, token: string): Promise<void> {
    if (!companyId || !token) {
      this.sendError(conn.ws, 'Missing companyId or token')
      return
    }

    // Validate the API key
    const keyHash = createHash('sha256').update(token).digest('hex')
    const result = await this.db.query<AgentApiKey>(
      `SELECT * FROM agent_api_keys WHERE key_hash = $1 AND status = $2`,
      [keyHash, AgentApiKeyStatus.Active],
    )

    if (result.rows.length === 0) {
      this.sendError(conn.ws, 'Unauthorized -- invalid API key')
      return
    }

    const apiKey = result.rows[0]

    // Ensure the API key belongs to the requested company
    if (apiKey.company_id !== companyId) {
      this.sendError(conn.ws, 'Unauthorized -- API key does not belong to this company')
      return
    }

    conn.companyId = companyId
    this.sendJson(conn.ws, { type: 'subscribed', companyId })
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      for (const conn of this.connections) {
        if (!conn.alive) {
          // No pong received since last ping -- terminate
          try {
            conn.ws.terminate()
          } catch {
            // Ignore terminate errors
          }
          this.connections.delete(conn)
          continue
        }

        conn.alive = false
        try {
          conn.ws.ping()
        } catch {
          this.connections.delete(conn)
        }
      }
    }, WebSocketManager.PING_INTERVAL_MS)
  }

  private sendJson(ws: WsWebSocket, data: Record<string, unknown>): void {
    try {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(data))
      }
    } catch {
      // Best-effort
    }
  }

  private sendError(ws: WsWebSocket, message: string): void {
    this.sendJson(ws, { type: 'error', message })
  }
}
