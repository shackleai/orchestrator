/**
 * HookRegistry — manages lifecycle hook handlers registered by plugins.
 *
 * Hooks are non-blocking: handler errors are logged but never fail the
 * calling operation. This mirrors the Observatory pattern — observability
 * should not break core flows.
 */

import type { HookEvent, HookHandler, HookPayload } from './types.js'

export class HookRegistry {
  private handlers = new Map<HookEvent, HookHandler[]>()

  /** Register a handler for a hook event. */
  register(event: HookEvent, handler: HookHandler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  /** Remove all handlers registered for a specific plugin (by reference). */
  unregisterAll(handlers: HookHandler[]): void {
    const toRemove = new Set(handlers)
    for (const [event, list] of this.handlers) {
      this.handlers.set(
        event,
        list.filter((h) => !toRemove.has(h)),
      )
    }
  }

  /**
   * Emit an event, running all registered handlers.
   * Errors are caught and logged — they never propagate to the caller.
   */
  async emit(event: HookEvent, data: Record<string, unknown>): Promise<void> {
    const list = this.handlers.get(event)
    if (!list || list.length === 0) return

    const payload: HookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    }

    const results = await Promise.allSettled(
      list.map((handler) => Promise.resolve(handler(payload))),
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[plugins] Hook handler error for '${event}':`, result.reason)
      }
    }
  }

  /** Check if any handlers are registered for an event. */
  has(event: HookEvent): boolean {
    const list = this.handlers.get(event)
    return list !== undefined && list.length > 0
  }

  /** Clear all registered handlers (used during shutdown). */
  clear(): void {
    this.handlers.clear()
  }
}
