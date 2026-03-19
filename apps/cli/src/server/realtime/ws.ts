/**
 * WebSocketManager — manages WebSocket connections for real-time dashboard updates.
 *
 * Features:
 * - Upgrades HTTP requests on /ws to WebSocket connections
 * - Tracks connections by companyId for scoped broadcasting
 * - Ping/pong keepalive with 30-second interval
 * - Auto-cleanup on disconnect or pong timeout
 *
 * Usage:
 *   const wsManager = new WebSocketManager()
 *   wsManager.attach(httpServer)
 *   wsManager.broadcast(companyId, { type: 'heartbeat_start', ... })
 */

import type { IncomingMessage } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { WebSocketEvent } from '@shackleai/shared'

/** Ping/pong keepalive interval in milliseconds (30 seconds). */
const KEEPALIVE_INTERVAL_MS = 30_000

interface TrackedConnection {
  ws: WebSocket
  companyId: string
  /** Whether we received a pong since the last ping. */
  alive: boolean
}

export class WebSocketManager {
  private wss: WebSocketServer | null = null
  private connections = new Map<WebSocket, TrackedConnection>()
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Attach to an existing HTTP server and start accepting WebSocket upgrades on /ws.
   * Must be called after the HTTP server is created (e.g. after `serve()` from @hono/node-server).
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true })

    // Handle upgrade requests — only accept /ws path
    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? 'localhost'}`,
      )

      if (url.pathname !== '/ws') {
        socket.destroy()
        return
      }

      // Extract companyId from query string: /ws?companyId=xxx
      const companyId = url.searchParams.get('companyId')
      if (!companyId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, companyId)
      })
    })

    this.startKeepalive()
  }

  /**
   * Broadcast an event to all connected clients for a given company.
   * Non-blocking — silently skips clients with closed connections.
   */
  broadcast(companyId: string, event: WebSocketEvent): void {
    const message = JSON.stringify(event)

    for (const tracked of this.connections.values()) {
      if (tracked.companyId !== companyId) continue
      if (tracked.ws.readyState !== WebSocket.OPEN) continue

      try {
        tracked.ws.send(message)
      } catch {
        // Best-effort — connection may have closed between check and send
      }
    }
  }

  /**
   * Broadcast to ALL connected clients regardless of company.
   * Use sparingly — only for system-wide events.
   */
  broadcastAll(event: WebSocketEvent): void {
    const message = JSON.stringify(event)

    for (const tracked of this.connections.values()) {
      if (tracked.ws.readyState !== WebSocket.OPEN) continue

      try {
        tracked.ws.send(message)
      } catch {
        // Best-effort
      }
    }
  }

  /** Get the count of active connections, optionally filtered by companyId. */
  getConnectionCount(companyId?: string): number {
    if (!companyId) return this.connections.size

    let count = 0
    for (const tracked of this.connections.values()) {
      if (tracked.companyId === companyId) count++
    }
    return count
  }

  /** Gracefully shut down — close all connections and stop keepalive. */
  close(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }

    for (const tracked of this.connections.values()) {
      try {
        tracked.ws.close(1001, 'Server shutting down')
      } catch {
        // Already closed
      }
    }

    this.connections.clear()
    this.wss?.close()
    this.wss = null
  }

  // -- Private ----------------------------------------------------------------

  private handleConnection(ws: WebSocket, companyId: string): void {
    const tracked: TrackedConnection = { ws, companyId, alive: true }
    this.connections.set(ws, tracked)

    ws.on('pong', () => {
      tracked.alive = true
    })

    ws.on('close', () => {
      this.connections.delete(ws)
    })

    ws.on('error', () => {
      this.connections.delete(ws)
      try {
        ws.terminate()
      } catch {
        // Already terminated
      }
    })

    // Send a welcome message so the client knows the connection is established
    const welcome: WebSocketEvent = {
      type: 'connected',
      companyId,
      timestamp: new Date().toISOString(),
      payload: { message: 'WebSocket connection established' },
    }

    try {
      ws.send(JSON.stringify(welcome))
    } catch {
      // Connection may have closed immediately
    }
  }

  /**
   * Start the keepalive loop — sends ping to all connections every 30 seconds.
   * Terminates connections that did not respond with pong since the last ping.
   */
  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      for (const [ws, tracked] of this.connections) {
        if (!tracked.alive) {
          // No pong received since last ping — terminate
          this.connections.delete(ws)
          try {
            ws.terminate()
          } catch {
            // Already dead
          }
          continue
        }

        // Mark as not alive — will be set back to true when pong is received
        tracked.alive = false
        try {
          ws.ping()
        } catch {
          this.connections.delete(ws)
        }
      }
    }, KEEPALIVE_INTERVAL_MS)

    // Don't let the keepalive timer prevent Node.js from exiting
    if (this.keepaliveTimer.unref) {
      this.keepaliveTimer.unref()
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — importable by executor, routes, or any server module
// ---------------------------------------------------------------------------

let _instance: WebSocketManager | null = null

/** Get the global WebSocketManager singleton. Creates it if it doesn't exist. */
export function getWebSocketManager(): WebSocketManager {
  if (!_instance) {
    _instance = new WebSocketManager()
  }
  return _instance
}

/**
 * Convenience broadcast — safe to call even before WebSocket is attached (no-op).
 * Import this from routes or the executor to emit real-time events.
 */
export function broadcast(companyId: string, event: WebSocketEvent): void {
  if (_instance) {
    _instance.broadcast(companyId, event)
  }
}
