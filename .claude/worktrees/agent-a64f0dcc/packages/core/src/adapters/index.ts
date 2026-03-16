/**
 * Adapters module — adapter registry, interfaces, and built-in adapters.
 */

export type { AdapterContext, AdapterModule, AdapterResult } from './adapter.js'
export { ProcessAdapter } from './process.js'
export { CrewAIAdapter } from './crewai.js'
export { getLastSessionState, saveSessionState } from './session.js'

import type { AdapterModule } from './adapter.js'
import { ProcessAdapter } from './process.js'
import { CrewAIAdapter } from './crewai.js'

/**
 * AdapterRegistry — maps adapter_type strings to AdapterModule instances.
 *
 * Pre-registers ProcessAdapter on construction. Additional adapters
 * (HTTP, Claude, MCP) are registered by their respective modules.
 */
export class AdapterRegistry {
  private adapters = new Map<string, AdapterModule>()

  constructor() {
    this.register(new ProcessAdapter())
    this.register(new CrewAIAdapter())
  }

  /** Register an adapter module. Overwrites any existing adapter with the same type. */
  register(adapter: AdapterModule): void {
    this.adapters.set(adapter.type, adapter)
  }

  /** Get an adapter by type key, or undefined if not registered. */
  get(type: string): AdapterModule | undefined {
    return this.adapters.get(type)
  }

  /** Check if an adapter type is registered. */
  has(type: string): boolean {
    return this.adapters.has(type)
  }

  /** List all registered adapter modules. */
  list(): AdapterModule[] {
    return [...this.adapters.values()]
  }
}
