import { PGlite } from '@electric-sql/pglite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseProvider, QueryResult } from './provider.js'

const DEFAULT_DATA_DIR = join(homedir(), '.shackleai', 'orchestrator', 'data')

export class PGliteProvider implements DatabaseProvider {
  private db: PGlite

  /**
   * Create a PGlite-backed database provider.
   * @param dataDir — Path to store data. Omit or pass undefined for in-memory mode.
   *                   Pass a path string for persistent storage (defaults to ~/.shackleai/orchestrator/data/).
   *                   Pass `'default'` to use the default data directory.
   */
  constructor(dataDir?: string) {
    if (dataDir === undefined) {
      // In-memory mode — no persistence, ideal for tests
      this.db = new PGlite()
    } else if (dataDir === 'default') {
      mkdirSync(DEFAULT_DATA_DIR, { recursive: true })
      this.db = new PGlite(DEFAULT_DATA_DIR)
    } else {
      mkdirSync(dataDir, { recursive: true })
      this.db = new PGlite(dataDir)
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params)
    return { rows: result.rows }
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}
