/**
 * PluginManager — high-level plugin lifecycle management.
 *
 * Coordinates the PluginLoader, HookRegistry, and AdapterRegistry to
 * provide install / uninstall / list / get operations.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { AdapterModule } from '../adapters/adapter.js'
import type { AdapterRegistry } from '../adapters/index.js'
import type {
  ShacklePlugin,
  PluginContext,
  PluginInfo,
  PluginRecord,
  PluginStatus,
  HookEvent,
  HookHandler,
} from './types.js'
import { HookRegistry } from './hooks.js'
import { PluginLoader, PluginValidationError } from './loader.js'

interface InitializedPlugin {
  plugin: ShacklePlugin
  hooks: HookHandler[]
}

export class PluginManager {
  private db: DatabaseProvider
  private adapterRegistry: AdapterRegistry
  private hookRegistry: HookRegistry
  private loader: PluginLoader
  private initialized = new Map<string, InitializedPlugin>()

  constructor(db: DatabaseProvider, adapterRegistry: AdapterRegistry) {
    this.db = db
    this.adapterRegistry = adapterRegistry
    this.hookRegistry = new HookRegistry()
    this.loader = new PluginLoader()
  }

  /** Get the hook registry (for emitting events from the runner). */
  getHooks(): HookRegistry {
    return this.hookRegistry
  }

  /**
   * Install a plugin from a source (npm package name or file path).
   * Persists the plugin record in the database.
   */
  async install(
    companyId: string,
    source: string,
    config: Record<string, unknown> = {},
  ): Promise<PluginInfo> {
    // Check DB for existing install BEFORE loading from npm to avoid
    // inconsistent error messages (in-memory check vs DB check race).
    const existing = await this.db.query<PluginRecord>(
      'SELECT id, name FROM plugins WHERE company_id = $1 AND name = $2',
      [companyId, source],
    )

    if (existing.rows.length > 0) {
      throw new Error(`Plugin '${existing.rows[0].name}' is already installed for this company`)
    }

    // Load and validate
    const plugin = await this.loader.loadFromNpm(source)

    // Re-check with the actual plugin name (may differ from source/package name)
    if (plugin.name !== source) {
      const existingByName = await this.db.query<PluginRecord>(
        'SELECT id FROM plugins WHERE company_id = $1 AND name = $2',
        [companyId, plugin.name],
      )

      if (existingByName.rows.length > 0) {
        this.loader.untrack(plugin.name)
        throw new Error(`Plugin '${plugin.name}' is already installed for this company`)
      }
    }

    // Initialize
    let status: PluginStatus = 'active'
    let errorMessage: string | null = null

    try {
      await this.initializePlugin(companyId, plugin, config)
    } catch (err) {
      status = 'error'
      errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[plugins] Failed to initialize '${plugin.name}':`, err)
    }

    // Persist to database
    const result = await this.db.query<PluginRecord>(
      `INSERT INTO plugins (company_id, name, version, config, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [companyId, plugin.name, plugin.version, JSON.stringify(config), status, errorMessage],
    )

    const record = result.rows[0]

    return {
      name: record.name,
      version: record.version,
      status: record.status,
      error_message: record.error_message,
      installed_at: record.installed_at,
    }
  }

  /**
   * Uninstall a plugin by name.
   * Calls shutdown(), removes hook handlers, and deletes the DB record.
   */
  async uninstall(companyId: string, name: string): Promise<boolean> {
    // Check exists in DB
    const existing = await this.db.query<PluginRecord>(
      'SELECT id FROM plugins WHERE company_id = $1 AND name = $2',
      [companyId, name],
    )

    if (existing.rows.length === 0) {
      return false
    }

    // Shut down if initialized
    const entry = this.initialized.get(this.pluginKey(companyId, name))
    if (entry) {
      try {
        await entry.plugin.shutdown?.()
      } catch (err) {
        console.error(`[plugins] Error during shutdown of '${name}':`, err)
      }

      // Remove hook handlers
      this.hookRegistry.unregisterAll(entry.hooks)
      this.initialized.delete(this.pluginKey(companyId, name))
    }

    // Remove from loader tracking
    this.loader.untrack(name)

    // Delete from database
    await this.db.query(
      'DELETE FROM plugins WHERE company_id = $1 AND name = $2',
      [companyId, name],
    )

    return true
  }

  /** List all installed plugins for a company. */
  async list(companyId: string): Promise<PluginInfo[]> {
    const result = await this.db.query<PluginRecord>(
      `SELECT name, version, status, error_message, installed_at
       FROM plugins
       WHERE company_id = $1
       ORDER BY installed_at ASC`,
      [companyId],
    )

    return result.rows.map((r) => ({
      name: r.name,
      version: r.version,
      status: r.status,
      error_message: r.error_message,
      installed_at: r.installed_at,
    }))
  }

  /** Get a specific installed plugin by name. */
  async getPlugin(companyId: string, name: string): Promise<PluginInfo | null> {
    const result = await this.db.query<PluginRecord>(
      `SELECT name, version, status, error_message, installed_at
       FROM plugins
       WHERE company_id = $1 AND name = $2`,
      [companyId, name],
    )

    if (result.rows.length === 0) return null

    const r = result.rows[0]
    return {
      name: r.name,
      version: r.version,
      status: r.status,
      error_message: r.error_message,
      installed_at: r.installed_at,
    }
  }

  /** Shut down all active plugins. Called during server shutdown. */
  async shutdownAll(): Promise<void> {
    for (const [key, entry] of this.initialized) {
      try {
        await entry.plugin.shutdown?.()
      } catch (err) {
        console.error(`[plugins] Error during shutdown of '${key}':`, err)
      }
    }
    this.initialized.clear()
    this.hookRegistry.clear()
  }

  private async initializePlugin(
    companyId: string,
    plugin: ShacklePlugin,
    config: Record<string, unknown>,
  ): Promise<void> {
    const registeredHooks: HookHandler[] = []

    const ctx: PluginContext = {
      db: this.db,
      companyId,
      registerAdapter: (_type: string, adapter: AdapterModule) => {
        this.adapterRegistry.register(adapter)
      },
      registerHook: (event: HookEvent, handler: HookHandler) => {
        this.hookRegistry.register(event, handler)
        registeredHooks.push(handler)
      },
      getConfig: () => ({ ...config }),
    }

    await plugin.initialize(ctx)

    this.initialized.set(this.pluginKey(companyId, plugin.name), {
      plugin,
      hooks: registeredHooks,
    })
  }

  private pluginKey(companyId: string, name: string): string {
    return `${companyId}:${name}`
  }
}

export { PluginValidationError }
