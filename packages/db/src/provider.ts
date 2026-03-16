/**
 * Database provider interface — abstracts over PGlite (local) and PostgreSQL (production).
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
}

export interface DatabaseProvider {
  /** Execute a single parameterized query. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>

  /** Execute one or more SQL statements (no parameter support). Used for migrations. */
  exec(sql: string): Promise<void>

  close(): Promise<void>
}
