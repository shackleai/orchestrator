/**
 * `shackleai start` — Start Hono server with API routes
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { PGliteProvider, PgProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import type { Company, Agent } from '@shackleai/shared'
import { readConfig } from '../config.js'

const VERSION = '0.1.0'

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

  // Create Hono app
  const app = new Hono()

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: VERSION })
  })

  app.get('/api/companies', async (c) => {
    const result = await db.query<Company>('SELECT * FROM companies')
    return c.json(result.rows)
  })

  app.get('/api/agents', async (c) => {
    const result = await db.query<Agent>('SELECT * FROM agents')
    return c.json(result.rows)
  })

  const port = options.port

  console.log(`
  ShackleAI Orchestrator v${VERSION}
  Company: ${config.companyName}
  Mode:    ${config.mode}

  Dashboard: http://localhost:${port}
  Health:    http://localhost:${port}/api/health
  `)

  serve({ fetch: app.fetch, port })
}
