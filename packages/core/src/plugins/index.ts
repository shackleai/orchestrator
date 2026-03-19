/**
 * Plugins module — extensible adapters, hooks, and integrations.
 */

export { PluginManager } from './manager.js'
export { PluginLoader, PluginValidationError, validatePlugin } from './loader.js'
export { HookRegistry } from './hooks.js'
export type {
  ShacklePlugin,
  PluginContext,
  PluginStatus,
  PluginRecord,
  PluginInfo,
  HookEvent,
  HookPayload,
  HookHandler,
} from './types.js'
