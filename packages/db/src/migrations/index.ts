import type { DatabaseProvider } from '../provider.js'
import * as m001 from './001_companies.js'
import * as m002 from './002_agents.js'
import * as m003 from './003_issues.js'
import * as m004 from './004_goals.js'
import * as m005 from './005_projects.js'
import * as m006 from './006_comments.js'
import * as m007 from './007_policies.js'
import * as m008 from './008_costs.js'
import * as m009 from './009_heartbeats.js'
import * as m010 from './010_activity.js'
import * as m011 from './011_api_keys.js'
import * as m012 from './012_license_keys.js'
import * as m013 from './013_agent_worktrees.js'
import * as m014 from './014_tool_calls.js'
import * as m015 from './015_indexes.js'
import * as m016 from './016_approvals.js'
import * as m017 from './017_secrets.js'
import * as m018 from './018_agent_config_revisions.js'
import * as m019 from './019_heartbeat_run_events.js'
import * as m020 from './020_quota_windows.js'
import * as m021 from './021_honesty_checklist.js'

export interface Migration {
  name: string
  sql: string
}

const migrations: Migration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020,
  m021,
]

/**
 * Track which DB instances have already been migrated in this process.
 * Prevents redundant migration runs (e.g., if both CLI init and server startup call runMigrations).
 */
const migratedInstances = new WeakSet<DatabaseProvider>()

/**
 * Run all pending migrations against the given database provider.
 * Tracks applied migrations in a `_migrations` table.
 * Idempotent — safe to call multiple times; second call on the same instance is a no-op.
 */
export async function runMigrations(db: DatabaseProvider): Promise<string[]> {
  if (migratedInstances.has(db)) {
    return []
  }

  // Ensure the migrations tracking table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // Get already-applied migrations
  const applied = await db.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY name',
  )
  const appliedSet = new Set(applied.rows.map((r) => r.name))

  const newly: string[] = []

  for (const migration of migrations) {
    if (appliedSet.has(migration.name)) {
      continue
    }

    // Wrap each migration in a transaction for atomicity
    await db.exec('BEGIN')
    try {
      await db.exec(migration.sql)
      await db.query('INSERT INTO _migrations (name) VALUES ($1)', [
        migration.name,
      ])
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
    newly.push(migration.name)
  }

  migratedInstances.add(db)
  return newly
}

export { migrations }
