/**
 * Plugin system types — extensible adapters, hooks, and integrations.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { AdapterModule } from '../adapters/adapter.js'

/** Lifecycle status of a plugin. */
export type PluginStatus = 'installed' | 'active' | 'error' | 'disabled'

/** Persistent plugin record in the database. */
export interface PluginRecord {
  id: string
  company_id: string
  name: string
  version: string
  config: Record<string, unknown>
  status: PluginStatus
  error_message: string | null
  installed_at: string
  updated_at: string
}

/** Result of plugin list operation. */
export interface PluginInfo {
  name: string
  version: string
  status: PluginStatus
  error_message: string | null
  installed_at: string
}

/** Hook event names emitted by the orchestrator lifecycle. */
export type HookEvent =
  | 'before_heartbeat'
  | 'after_heartbeat'
  | 'before_adapter_execute'
  | 'after_adapter_execute'
  | 'on_cost_event'
  | 'on_task_complete'

/** Payload passed to hook handlers. */
export interface HookPayload {
  event: HookEvent
  timestamp: string
  data: Record<string, unknown>
}

/** A function that handles a hook event. */
export type HookHandler = (payload: HookPayload) => Promise<void> | void

/** Context provided to plugins during initialization. */
export interface PluginContext {
  /** Database access for plugin state. */
  db: DatabaseProvider
  /** Company ID this plugin is installed for. */
  companyId: string
  /** Register a custom adapter type. */
  registerAdapter(type: string, adapter: AdapterModule): void
  /** Register a hook handler for a lifecycle event. */
  registerHook(event: HookEvent, handler: HookHandler): void
  /** Get the plugin's persisted configuration. */
  getConfig(): Record<string, unknown>
}

/** The contract every ShackleAI plugin must satisfy. */
export interface ShacklePlugin {
  /** Unique plugin name (e.g. 'shackle-slack-notifier'). */
  name: string
  /** SemVer version string. */
  version: string
  /** Called once when the plugin is installed/loaded. */
  initialize(ctx: PluginContext): Promise<void>
  /** Called when the plugin is uninstalled or the server shuts down. */
  shutdown?(): Promise<void>
}
