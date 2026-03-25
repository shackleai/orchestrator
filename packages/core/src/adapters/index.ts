/**
 * Adapters module — adapter registry, interfaces, and built-in adapters.
 */

export type { AdapterContext, AdapterModule, AdapterResult, GoalAncestry } from './adapter.js'
export { ProcessAdapter } from './process.js'
export { HttpAdapter } from './http.js'
export { ClaudeAdapter } from './claude.js'
export { McpAdapter } from './mcp.js'
export { OpenClawAdapter } from './openclaw.js'
export { CrewAIAdapter } from './crewai.js'
export { CodexAdapter } from './codex.js'
export { CursorAdapter } from './cursor.js'
export { GeminiAdapter } from './gemini.js'
export { KiroAdapter } from './kiro.js'
export { OpenCodeAdapter } from './opencode.js'
export { LlmAdapter } from './llm.js'
export { getLastSessionState, saveSessionState, compactSession } from './session.js'

import type { AdapterModule } from './adapter.js'
import { ProcessAdapter } from './process.js'
import { HttpAdapter } from './http.js'
import { ClaudeAdapter } from './claude.js'
import { McpAdapter } from './mcp.js'
import { OpenClawAdapter } from './openclaw.js'
import { CrewAIAdapter } from './crewai.js'
import { CodexAdapter } from './codex.js'
import { CursorAdapter } from './cursor.js'
import { GeminiAdapter } from './gemini.js'
import { KiroAdapter } from './kiro.js'
import { OpenCodeAdapter } from './opencode.js'
import { LlmAdapter } from './llm.js'

/**
 * AdapterRegistry — maps adapter_type strings to AdapterModule instances.
 *
 * Pre-registers all built-in adapters on construction.
 */
export class AdapterRegistry {
  private adapters = new Map<string, AdapterModule>()

  constructor() {
    this.register(new ProcessAdapter())
    this.register(new HttpAdapter())
    this.register(new ClaudeAdapter())
    this.register(new McpAdapter())
    this.register(new OpenClawAdapter())
    this.register(new CrewAIAdapter())
    this.register(new CodexAdapter())
    this.register(new CursorAdapter())
    this.register(new GeminiAdapter())
    this.register(new KiroAdapter())
    this.register(new OpenCodeAdapter())
    this.register(new LlmAdapter())
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
