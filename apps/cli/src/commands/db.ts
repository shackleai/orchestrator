/**
 * `shackleai db` — Database backup and restore commands
 */

import type { Command } from 'commander'
import { createGzip, createGunzip } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import * as p from '@clack/prompts'
import { PGliteProvider, PgProvider } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { readConfig, resolveDatabaseUrl } from '../config.js'
import { VERSION } from '../index.js'

/**
 * All user-created tables in migration order.
 * Excludes `_migrations` (internal bookkeeping).
 */
const BACKUP_TABLES = [
  'companies',
  'agents',
  'issues',
  'goals',
  'projects',
  'issue_comments',
  'policies',
  'cost_events',
  'heartbeat_runs',
  'activity_log',
  'agent_api_keys',
  'license_keys',
  'agent_worktrees',
  'tool_calls',
  'approvals',
  'secrets',
  'agent_config_revisions',
  'heartbeat_run_events',
  'quota_windows',
  'issue_work_products',
  'labels',
  'issue_labels',
  'issue_attachments',
  'documents',
  'document_revisions',
  'issue_documents',
  'agent_wakeup_requests',
  'issue_read_states',
] as const

interface BackupMetadata {
  version: string
  timestamp: string
  format: 'shackleai-backup-v1'
  mode: 'local' | 'server'
  tables: Record<string, number>
}

interface BackupData {
  metadata: BackupMetadata
  data: Record<string, Record<string, unknown>[]>
}

function getDefaultBackupDir(): string {
  return join(homedir(), '.shackleai', 'orchestrator', 'backups')
}

function getDefaultBackupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(getDefaultBackupDir(), `backup-${timestamp}.json.gz`)
}

/**
 * Create a DatabaseProvider from the current config.
 */
async function createDbFromConfig(): Promise<DatabaseProvider> {
  const config = await readConfig()
  if (!config) {
    p.log.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  if (config.mode === 'local') {
    return new PGliteProvider(config.dataDir ?? 'default')
  }

  const { url } = resolveDatabaseUrl(config)
  if (!url) {
    p.log.error(
      'No database URL configured. Set SHACKLEAI_DATABASE_URL env var or run `shackleai init`.',
    )
    process.exit(1)
  }

  return new PgProvider(url)
}

/**
 * `shackleai db backup` — Dump all tables to a compressed JSON file.
 */
async function dbBackup(options: { output?: string }): Promise<void> {
  const config = await readConfig()
  if (!config) {
    p.log.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  const outputPath = options.output ?? getDefaultBackupPath()
  const outputDir = join(outputPath, '..')

  await mkdir(outputDir, { recursive: true })

  const spin = p.spinner()
  spin.start('Connecting to database...')

  const db = await createDbFromConfig()

  try {
    const backupData: BackupData = {
      metadata: {
        version: VERSION,
        timestamp: new Date().toISOString(),
        format: 'shackleai-backup-v1',
        mode: config.mode,
        tables: {},
      },
      data: {},
    }

    spin.stop('Connected')
    spin.start('Exporting tables...')

    let totalRows = 0

    for (const table of BACKUP_TABLES) {
      try {
        const result = await db.query(`SELECT * FROM ${table}`)
        backupData.data[table] = result.rows
        backupData.metadata.tables[table] = result.rows.length
        totalRows += result.rows.length
      } catch {
        // Table may not exist if migrations haven't all run — skip silently
        backupData.data[table] = []
        backupData.metadata.tables[table] = 0
      }
    }

    spin.stop(`Exported ${totalRows} rows from ${BACKUP_TABLES.length} tables`)
    spin.start('Compressing and writing backup...')

    const json = JSON.stringify(backupData, null, 2)
    const inputStream = Readable.from(Buffer.from(json, 'utf-8'))
    const gzipStream = createGzip({ level: 9 })
    const outputStream = createWriteStream(outputPath)

    await pipeline(inputStream, gzipStream, outputStream)

    const fileStats = await stat(outputPath)
    const sizeMB = (fileStats.size / (1024 * 1024)).toFixed(2)

    spin.stop('Backup complete')

    p.log.success(`Backup saved to: ${outputPath}`)
    p.log.info(`Size: ${sizeMB} MB | Rows: ${totalRows} | Tables: ${Object.keys(backupData.metadata.tables).filter((t) => backupData.metadata.tables[t] > 0).length}`)
  } finally {
    await db.close()
  }
}

/**
 * `shackleai db restore` — Restore all tables from a compressed JSON backup.
 */
async function dbRestore(path: string, options: { yes?: boolean }): Promise<void> {
  const config = await readConfig()
  if (!config) {
    p.log.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  // Validate file exists
  try {
    await stat(path)
  } catch {
    p.log.error(`Backup file not found: ${path}`)
    process.exit(1)
  }

  // Read and decompress
  const spin = p.spinner()
  spin.start('Reading backup file...')

  let backupData: BackupData

  try {
    if (path.endsWith('.gz')) {
      const chunks: Buffer[] = []
      const inputStream = createReadStream(path)
      const gunzipStream = createGunzip()

      const decompressStream = inputStream.pipe(gunzipStream)
      for await (const chunk of decompressStream) {
        chunks.push(chunk as Buffer)
      }

      const json = Buffer.concat(chunks).toString('utf-8')
      backupData = JSON.parse(json) as BackupData
    } else {
      const json = await readFile(path, 'utf-8')
      backupData = JSON.parse(json) as BackupData
    }
  } catch (err) {
    spin.stop('Failed')
    const message = err instanceof Error ? err.message : String(err)
    p.log.error(`Failed to read backup: ${message}`)
    process.exit(1)
  }

  // Validate format
  if (backupData.metadata?.format !== 'shackleai-backup-v1') {
    spin.stop('Failed')
    p.log.error('Invalid backup format. Expected format: shackleai-backup-v1')
    process.exit(1)
  }

  const tableCount = Object.keys(backupData.metadata.tables).filter(
    (t) => backupData.metadata.tables[t] > 0,
  ).length
  const totalRows = Object.values(backupData.metadata.tables).reduce(
    (sum, count) => sum + count,
    0,
  )

  spin.stop('Backup file validated')

  p.log.info(`Backup from: ${backupData.metadata.timestamp}`)
  p.log.info(`Version: ${backupData.metadata.version} | Tables: ${tableCount} | Rows: ${totalRows}`)

  // Confirmation prompt
  if (!options.yes) {
    const confirm = await p.confirm({
      message: 'This will overwrite all existing data. Continue?',
    })

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Restore cancelled.')
      process.exit(0)
    }
  }

  spin.start('Connecting to database...')
  const db = await createDbFromConfig()

  try {
    spin.stop('Connected')
    spin.start('Restoring data...')

    await db.transaction(async (tx) => {
      // Delete existing data in reverse order (respects foreign keys)
      const reverseTables = [...BACKUP_TABLES].reverse()
      for (const table of reverseTables) {
        try {
          await tx.exec(`DELETE FROM ${table}`)
        } catch {
          // Table may not exist — skip
        }
      }

      // Insert data in forward order (respects foreign keys)
      for (const table of BACKUP_TABLES) {
        const rows = backupData.data[table]
        if (!rows || rows.length === 0) continue

        for (const row of rows) {
          const columns = Object.keys(row)
          const placeholders = columns.map((_, i) => `$${i + 1}`)
          const values = columns.map((col) => {
            const val = row[col]
            // Serialize JSON objects/arrays as strings for JSONB columns
            if (val !== null && typeof val === 'object') {
              return JSON.stringify(val)
            }
            return val
          })

          const sql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`
          await tx.query(sql, values)
        }
      }
    })

    spin.stop('Restore complete')
    p.log.success(`Restored ${totalRows} rows across ${tableCount} tables`)
  } catch (err) {
    spin.stop('Restore failed')
    const message = err instanceof Error ? err.message : String(err)
    p.log.error(`Restore failed (transaction rolled back): ${message}`)
    process.exit(1)
  } finally {
    await db.close()
  }
}

export function registerDbCommand(program: Command): void {
  const dbCmd = program
    .command('db')
    .description('Database backup and restore')

  dbCmd
    .command('backup')
    .description('Dump all tables to a compressed JSON backup file')
    .option(
      '-o, --output <path>',
      'Output file path (default: ~/.shackleai/orchestrator/backups/backup-{timestamp}.json.gz)',
    )
    .action(async (opts: { output?: string }) => {
      await dbBackup(opts)
    })

  dbCmd
    .command('restore <path>')
    .description('Restore database from a backup file')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (path: string, opts: { yes?: boolean }) => {
      await dbRestore(path, opts)
    })
}
