/**
 * Hello World plugin — minimal example of a ShackleAI plugin.
 *
 * Demonstrates:
 *   - Plugin interface implementation
 *   - Hook registration
 *   - Plugin configuration access
 *
 * Usage:
 *   import helloWorldPlugin from './hello-world.js'
 *   await pluginManager.install(companyId, './hello-world.js')
 */

import type { ShacklePlugin, PluginContext } from '../types.js'

const helloWorldPlugin: ShacklePlugin = {
  name: 'hello-world',
  version: '1.0.0',

  async initialize(ctx: PluginContext): Promise<void> {
    const config = ctx.getConfig()
    const greeting = (config.greeting as string) ?? 'Hello from plugin!'

    console.log(`[hello-world] Initialized for company ${ctx.companyId}: ${greeting}`)

    // Register a hook that logs after every heartbeat
    ctx.registerHook('after_heartbeat', (payload) => {
      console.log(`[hello-world] Heartbeat completed:`, payload.data)
    })

    // Register a hook for task completion
    ctx.registerHook('on_task_complete', (payload) => {
      console.log(`[hello-world] Task completed:`, payload.data)
    })
  },

  async shutdown(): Promise<void> {
    console.log('[hello-world] Shutting down.')
  },
}

export default helloWorldPlugin
export { helloWorldPlugin as plugin }
