/**
 * `shackleai start` — Start Hono server with API routes
 */

import net from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
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
  GovernanceEngine,
  QuotaManager,
  createStorageProvider,
} from '@shackleai/core'
import { AgentApiKeyStatus } from '@shackleai/shared'
import { readConfig, writeConfig, resolveDatabaseUrl } from '../config.js'
import type { ShackleAIConfig } from '../config.js'
import { createApp } from '../server/index.js'
import { VERSION } from '../index.js'

export async function startCommand(options: { port: number }): Promise<void> {
  let config = await readConfig()

  // DB may be created by autoInitFromEnv — reused to avoid double initialization
  let db: DatabaseProvider | undefined

  if (!config) {
    // Auto-init from env vars — supports Docker deployments without interactive `init`
    const companyName = process.env.SHACKLEAI_COMPANY_NAME
    if (companyName) {
      const result = await autoInitFromEnv(companyName)
      config = result.config
      db = result.db
    } else {
      console.error(
        'No configuration found. Run `shackleai init` first to set up.',
      )
      process.exit(1)
    }
  }

  // Inject LLM keys into process env so agent child processes inherit them
  if (config.llmKeys?.openai) {
    process.env.OPENAI_API_KEY = config.llmKeys.openai
  }
  if (config.llmKeys?.anthropic) {
    process.env.ANTHROPIC_API_KEY = config.llmKeys.anthropic
  }

  // Initialize DB if not already created by autoInitFromEnv
  if (!db) {
    if (config.mode === 'local') {
      db = new PGliteProvider(config.dataDir ?? 'default')
    } else {
      const { url: dbUrl, source } = resolveDatabaseUrl(config)
      if (!dbUrl) {
        console.error(
          'Server mode requires a database URL.\n' +
          'Set SHACKLEAI_DATABASE_URL env var or run `shackleai init` again.',
        )
        process.exit(1)
      }
      if (source === 'env') {
        console.log('  Using DATABASE_URL from SHACKLEAI_DATABASE_URL env var.')
      }
      db = new PgProvider(dbUrl)
    }
  }

  // runMigrations has a WeakSet guard — safe even if autoInitFromEnv already ran it
  await runMigrations(db)

  // Ensure at least one API key exists � generate a default admin key on first start
  await ensureDefaultApiKey(db, config.companyId)

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

  // GovernanceEngine enforces policies before adapter execution
  const governance = new GovernanceEngine(db)

  // QuotaManager enforces time-windowed provider-level quotas
  const quotaManager = new QuotaManager(db)

  // HeartbeatExecutor is the single source of truth for heartbeat_run records
  const executor = new HeartbeatExecutor(db, costTracker, observatory, adapterRegistry, governance, quotaManager)

  // Scheduler wraps executor with coalescing and cron scheduling
  const scheduler = new Scheduler(db, (agentId, trigger) =>
    executor.execute(agentId, trigger),
  )
  await scheduler.start()

  // Storage provider for file attachments (defaults to local disk)
  const storage = createStorageProvider({ type: 'local-disk' })

  const app = createApp(db, { scheduler, storage })

  // Find an available port — try requested port first, then auto-increment
  const requestedPort = options.port
  const port = await findAvailablePort(requestedPort, options.port !== 4800)

  if (port !== requestedPort) {
    console.log(`  Port ${requestedPort} is in use — using ${port} instead.\n`)
  }

  // Persist port to config so other CLI commands can find it
  await writeConfig({ ...config, port })

  console.log(`
  ShackleAI Orchestrator v${VERSION}
  Company: ${config.companyName}
  Mode:    ${config.mode}

  Dashboard: http://127.0.0.1:${port}
  Health:    http://127.0.0.1:${port}/api/health

  Press Ctrl+C to stop.
  `)

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })

  // Prevent stdin from keeping the process waiting for input on Windows
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (key) => {
      // Ctrl+C = 0x03
      if (key[0] === 0x03) shutdown()
    })
  }

  // Graceful shutdown on Ctrl+C
  const shutdown = () => {
    console.log('\n  Shutting down ShackleAI Orchestrator...')
    scheduler.stop()
    db!.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Auto-initialize orchestrator from environment variables.
 * Used for Docker deployments where interactive `shackleai init` is not possible.
 *
 * Required env vars:
 *   SHACKLEAI_COMPANY_NAME — company name (required)
 *
 * Optional env vars:
 *   SHACKLEAI_MODE         — "local" (default) or "server"
 *   SHACKLEAI_DATABASE_URL — PostgreSQL URL (required when mode=server)
 */
async function autoInitFromEnv(
  companyName: string,
): Promise<{ config: ShackleAIConfig; db: DatabaseProvider }> {
  console.log(`  Auto-initializing from environment variables...`)

  const mode = (process.env.SHACKLEAI_MODE ?? 'local') as 'local' | 'server'
  const databaseUrl = process.env.SHACKLEAI_DATABASE_URL

  if (mode === 'server' && !databaseUrl) {
    console.error(
      'SHACKLEAI_DATABASE_URL is required when SHACKLEAI_MODE=server.',
    )
    process.exit(1)
  }

  let db: DatabaseProvider
  if (mode === 'local') {
    db = new PGliteProvider('default')
  } else {
    db = new PgProvider(databaseUrl!)
  }

  await runMigrations(db)

  const issuePrefix = companyName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)

  let companyId: string
  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO companies (name, issue_prefix)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [companyName.trim(), issuePrefix || 'MAIN'],
    )
    companyId = result.rows[0].id
  } catch (err) {
    // Company may already exist — fetch it
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE name = $1`,
      [companyName.trim()],
    )
    if (existing.rows.length > 0) {
      companyId = existing.rows[0].id
    } else {
      console.error(
        `Failed to create company: ${err instanceof Error ? err.message : String(err)}`,
      )
      await db.close()
      process.exit(1)
    }
  }

  // Never persist databaseUrl from env vars — it stays in the environment
  const config: ShackleAIConfig = {
    mode,
    companyId,
    companyName: companyName.trim(),
    ...(mode === 'local' ? { dataDir: 'default' } : {}),
  }

  await writeConfig(config)
  console.log(`  Initialized company "${companyName.trim()}" (${companyId})`)
  // Return both config and the open DB — caller reuses this connection
  return { config, db }
}


/**
 * Ensure at least one API key exists for the company.
 * On first start, creates a default admin agent and generates an API key.
 */
async function ensureDefaultApiKey(db: DatabaseProvider, companyId: string): Promise<void> {
  const existing = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM agent_api_keys WHERE company_id = $1 AND status = $2`,
    [companyId, AgentApiKeyStatus.Active],
  )

  const count = parseInt(existing.rows[0]?.count ?? '0', 10)
  if (count > 0) {
    return
  }

  let adminAgentId: string
  const adminAgent = await db.query<{ id: string }>(
    `SELECT id FROM agents WHERE company_id = $1 AND name = $2 LIMIT 1`,
    [companyId, '__admin__'],
  )

  if (adminAgent.rows.length > 0) {
    adminAgentId = adminAgent.rows[0].id
  } else {
    const created = await db.query<{ id: string }>(
      `INSERT INTO agents (company_id, name, title, role, status, adapter_type, adapter_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [companyId, '__admin__', 'Admin Service Account', 'admin', 'active', 'process', JSON.stringify({})],
    )
    adminAgentId = created.rows[0].id
  }

  const plainKey = randomBytes(32).toString('hex')
  const keyHash = createHash('sha256').update(plainKey).digest('hex')

  await db.query(
    `INSERT INTO agent_api_keys (agent_id, company_id, key_hash, label, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminAgentId, companyId, keyHash, 'default-admin', AgentApiKeyStatus.Active],
  )

  console.log(`
  =====================================================================
  DEFAULT API KEY GENERATED

  All API routes now require authentication.
  Use this key in the Authorization header:

    Authorization: Bearer ${plainKey}

  Save this key � it will NOT be shown again.
  =====================================================================
  `)
}

/** Check if a port is available by trying to listen on it */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** Find an available port starting from the requested one */
async function findAvailablePort(startPort: number, strict: boolean): Promise<number> {
  // If user explicitly set --port, fail hard if it's taken
  if (strict) {
    const available = await isPortAvailable(startPort)
    if (!available) {
      console.error(`  Error: Port ${startPort} is already in use.`)
      process.exit(1)
    }
    return startPort
  }

  // Auto-find: try startPort, then +1, +2, ... up to 10 attempts
  for (let i = 0; i < 10; i++) {
    const candidate = startPort + i
    if (await isPortAvailable(candidate)) {
      return candidate
    }
  }

  console.error(`  Error: No available port found in range ${startPort}-${startPort + 9}.`)
  process.exit(1)
}
