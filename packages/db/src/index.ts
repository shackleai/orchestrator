/**
 * @shackleai/db — Database layer for the ShackleAI orchestrator.
 *
 * Provides a DatabaseProvider interface with two implementations:
 * - PGliteProvider: Embedded PostgreSQL for local development (via @electric-sql/pglite)
 * - PgProvider: Standard PostgreSQL for production (via pg)
 *
 * Also includes a migration runner that applies 12 schema migrations.
 */

export type { DatabaseProvider, QueryResult } from './provider.js'
export { PGliteProvider } from './pglite-provider.js'
export { PgProvider } from './pg-provider.js'
export { runMigrations } from './migrations/index.js'
export type { Migration } from './migrations/index.js'
