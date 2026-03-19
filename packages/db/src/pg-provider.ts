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

  async transaction<T>(fn: (tx: DatabaseProvider) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const txProvider: DatabaseProvider = {
        query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query<R & pg.QueryResultRow>(sql, params)
          return { rows: result.rows }
        },
        exec: async (sql: string) => {
          await client.query(sql)
        },
        transaction: () => {
          throw new Error('Nested transactions are not supported')
        },
        close: () => {
          throw new Error('Cannot close a transactional provider')
        },
      }
      const result = await fn(txProvider)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
