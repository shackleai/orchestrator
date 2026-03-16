/**
 * `shackleai start` — Start Hono server with API routes
 */

import { serve } from '@hono/node-server'
import { PGliteProvider, PgProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import {
  Scheduler,
  HeartbeatExecutor,
  CostTracker,
  Observatory,
  AdapterRegistry,
  ProcessAdapter,
  HttpAdapter,
  ClaudeAdapter,
  McpAdapter,
  OpenClawAdapter,
  CrewAIAdapter,
} from '@shackleai/core'
import { readConfig, writeConfig } from '../config.js'
import { createApp } from '../server/index.js'
import { VERSION } from '../index.js'

export async function startCommand(options: { port: number }): Promise<void> {
  const config = await readConfig()

  if (!config) {
    console.error(
      'No configuration found. Run `shackleai init` first to set up.',
    )
    process.exit(1)
  }

  // Initialize DB
  let db: DatabaseProvider
  if (config.mode === 'local') {
    db = new PGliteProvider(config.dataDir ?? 'default')
  } else {
    if (!config.databaseUrl) {
      console.error(
        'Server mode requires a DATABASE_URL. Run `shackleai init` again.',
      )
      process.exit(1)
    }
    db = new PgProvider(config.databaseUrl)
  }

  await runMigrations(db)

  // Initialize core services
  const costTracker = new CostTracker(db)
  const observatory = new Observatory(db)
  const adapterRegistry = new AdapterRegistry()
  adapterRegistry.register(new ProcessAdapter())
  adapterRegistry.register(new HttpAdapter())
  adapterRegistry.register(new ClaudeAdapter())
  adapterRegistry.register(new McpAdapter())
  adapterRegistry.register(new OpenClawAdapter())
  adapterRegistry.register(new CrewAIAdapter())

  // HeartbeatExecutor is the single source of truth for heartbeat_run records
  const executor = new HeartbeatExecutor(db, costTracker, observatory, adapterRegistry)

  // Scheduler wraps executor with coalescing and cron scheduling
  const scheduler = new Scheduler(db, (agentId, trigger) =>
    executor.execute(agentId, trigger),
  )
  await scheduler.start()

  const app = createApp(db, { scheduler })

  const port = options.port

  // Persist port to config so other CLI commands can find it
  await writeConfig({ ...config, port })

  console.log(`
  ShackleAI Orchestrator v${VERSION}
  Company: ${config.companyName}
  Mode:    ${config.mode}

  Dashboard: http://127.0.0.1:${port}
  Health:    http://127.0.0.1:${port}/api/health
  `)

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
}
