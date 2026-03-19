/**
 * PluginLoader — discovers and validates plugin modules.
 *
 * Supports two sources:
 *   1. Directory scanning — loads all plugin packages from a directory
 *   2. NPM packages — require() a named npm package
 *
 * A valid plugin module must default-export (or named-export `plugin`)
 * an object satisfying the ShacklePlugin interface.
 */

import { readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { ShacklePlugin } from './types.js'

/** Validation error for malformed plugins. */
export class PluginValidationError extends Error {
  constructor(
    public readonly source: string,
    message: string,
  ) {
    super(`Invalid plugin '${source}': ${message}`)
    this.name = 'PluginValidationError'
  }
}

/**
 * Validate that a value satisfies the ShacklePlugin shape.
 * Does not use Zod — plugins are external code, we validate structurally.
 */
export function validatePlugin(source: string, obj: unknown): ShacklePlugin {
  if (obj === null || typeof obj !== 'object') {
    throw new PluginValidationError(source, 'Export is not an object')
  }

  const plugin = obj as Record<string, unknown>

  if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
    throw new PluginValidationError(source, 'Missing or empty "name" string')
  }

  if (typeof plugin.version !== 'string' || plugin.version.length === 0) {
    throw new PluginValidationError(source, 'Missing or empty "version" string')
  }

  if (typeof plugin.initialize !== 'function') {
    throw new PluginValidationError(source, 'Missing "initialize" function')
  }

  if (plugin.shutdown !== undefined && typeof plugin.shutdown !== 'function') {
    throw new PluginValidationError(source, '"shutdown" must be a function if provided')
  }

  return obj as ShacklePlugin
}

/**
 * Extract a ShacklePlugin from a module's exports.
 * Checks: default export, named `plugin` export, then the module itself.
 */
export function extractPlugin(source: string, mod: Record<string, unknown>): ShacklePlugin {
  // ES module default export
  if (mod.default && typeof mod.default === 'object') {
    return validatePlugin(source, mod.default)
  }

  // Named export `plugin`
  if (mod.plugin && typeof mod.plugin === 'object') {
    return validatePlugin(source, mod.plugin)
  }

  // Module itself is the plugin
  return validatePlugin(source, mod)
}

export class PluginLoader {
  private loaded = new Map<string, ShacklePlugin>()

  /** Load all plugin packages from a directory. Each subdirectory should be a valid plugin. */
  async loadFromDirectory(dir: string): Promise<ShacklePlugin[]> {
    const entries = await readdir(resolve(dir), { withFileTypes: true })
    const plugins: ShacklePlugin[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.name.endsWith('.js') && !entry.name.endsWith('.ts')) {
        continue
      }

      const modulePath = join(resolve(dir), entry.name)
      try {
        const plugin = await this.loadModule(modulePath)
        plugins.push(plugin)
      } catch (err) {
        console.error(`[plugins] Failed to load plugin from ${modulePath}:`, err)
      }
    }

    return plugins
  }

  /** Load a single plugin from an npm package name or file path. */
  async loadFromNpm(packageName: string): Promise<ShacklePlugin> {
    return this.loadModule(packageName)
  }

  /** Get all loaded plugins. */
  getLoaded(): Map<string, ShacklePlugin> {
    return new Map(this.loaded)
  }

  /** Check if a plugin is already loaded. */
  isLoaded(name: string): boolean {
    return this.loaded.has(name)
  }

  /** Remove a plugin from the loaded set. */
  untrack(name: string): void {
    this.loaded.delete(name)
  }

  private async loadModule(source: string): Promise<ShacklePlugin> {
    // Dynamic import for ESM compatibility
    const mod = (await import(source)) as Record<string, unknown>
    const plugin = extractPlugin(source, mod)

    if (this.loaded.has(plugin.name)) {
      throw new PluginValidationError(
        source,
        `Plugin '${plugin.name}' is already loaded`,
      )
    }

    this.loaded.set(plugin.name, plugin)
    return plugin
  }
}
