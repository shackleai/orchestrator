import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGliteProvider } from '../src/pglite-provider.js'
import { runMigrations, migrations } from '../src/migrations/index.js'

describe('Migration Runner', () => {
  let db: PGliteProvider

  beforeAll(async () => {
    db = new PGliteProvider()
  })

  afterAll(async () => {
    await db.close()
  })

  it('should apply all 12 migrations on a fresh database', async () => {
    const applied = await runMigrations(db)
    expect(applied).toHaveLength(12)

    // Verify they match the expected migration names in order
    const expectedNames = migrations.map((m) => m.name)
    expect(applied).toEqual(expectedNames)
  })

  it('should be idempotent — running again applies zero migrations', async () => {
    const applied = await runMigrations(db)
    expect(applied).toHaveLength(0)
  })

  it('should track applied migrations in the _migrations table', async () => {
    const result = await db.query<{ name: string; applied_at: string }>(
      'SELECT name, applied_at FROM _migrations ORDER BY name',
    )
    expect(result.rows).toHaveLength(12)
    expect(result.rows[0].name).toBe('001_companies')
    expect(result.rows[11].name).toBe('012_license_keys')

    // Each row should have an applied_at timestamp
    for (const row of result.rows) {
      expect(row.applied_at).toBeTruthy()
    }
  })

  it('should have created all expected tables', async () => {
    const result = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const tableNames = result.rows.map((r) => r.tablename)

    const expectedTables = [
      '_migrations',
      'activity_log',
      'agent_api_keys',
      'agents',
      'companies',
      'cost_events',
      'goals',
      'heartbeat_runs',
      'issue_comments',
      'issues',
      'license_keys',
      'policies',
      'projects',
    ]

    for (const table of expectedTables) {
      expect(tableNames).toContain(table)
    }
  })
})
