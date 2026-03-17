/**
 * `shackleai config` — Config versioning, rollback, and export
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import { listConfigHistory, rollbackConfig, exportConfig } from '../config.js'

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
}
