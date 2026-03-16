import pg from 'pg'
import type { DatabaseProvider, QueryResult } from './provider.js'

const { Pool } = pg

export class PgProvider implements DatabaseProvider {
  private pool: pg.Pool

  constructor(config: string | pg.PoolConfig) {
    if (typeof config === 'string') {
      this.pool = new Pool({ connectionString: config })
    } else {
      this.pool = new Pool(config)
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query<T & pg.QueryResultRow>(sql, params)
    return { rows: result.rows }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
