/**
 * `shackleai config` — Config versioning, rollback, and export
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import { listConfigHistory, rollbackConfig, exportConfig, stripSensitiveFromConfig, getConfigPath } from '../config.js'

async function configHistory(): Promise<void> {
  const history = await listConfigHistory()
  if (history.length === 0) {
    console.log('No config history found.')
    return
  }
  console.log('Config history (most recent first):')
  for (const file of history) {
    console.log(`  ${file}`)
  }
}

async function configRollback(): Promise<void> {
  const config = await rollbackConfig()
  if (!config) {
    p.log.warning('No config backup found to rollback to.')
    return
  }
  p.log.success(`Config restored: ${config.companyName} (${config.mode} mode)`)
}

async function configExport(): Promise<void> {
  const exported = await exportConfig()
  if (!exported) {
    p.log.warning('No config found. Run `shackleai init` first.')
    return
  }
  console.log(exported)
}

async function configRedact(): Promise<void> {
  const stripped = await stripSensitiveFromConfig()
  if (stripped.length === 0) {
    p.log.info('No sensitive values found in config (or no config exists).')
    p.log.info(
      'Tip: Set SHACKLEAI_DATABASE_URL env var so credentials never touch disk.',
    )
    return
  }
  p.log.success(`Stripped ${stripped.length} sensitive field(s) from config:`)
  for (const field of stripped) {
    console.log(`  - ${field}`)
  }
  p.log.info(`Config file: ${getConfigPath()}`)
  p.log.info(
    'Set SHACKLEAI_DATABASE_URL env var before running `shackleai start`.',
  )
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage orchestrator configuration')

  configCmd
    .command('history')
    .description('List saved config versions')
    .action(configHistory)

  configCmd
    .command('rollback')
    .description('Restore previous config version')
    .action(configRollback)

  configCmd
    .command('export')
    .description('Print config with secrets redacted')
    .action(configExport)

  configCmd
    .command('redact')
    .description('Strip sensitive values (databaseUrl, llmKeys) from config file')
    .action(configRedact)
}
