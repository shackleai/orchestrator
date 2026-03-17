#!/usr/bin/env node

/**
 * @shackleai/orchestrator — CLI entrypoint
 */

import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { startCommand } from './commands/start.js'
import { registerAgentCommand } from './commands/agent.js'
import { registerTaskCommand } from './commands/task.js'
import { registerRunCommand } from './commands/run.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerUpgradeCommand } from './commands/upgrade.js'
import { registerWorktreeCommand } from './commands/worktree.js'
import { registerCompanyCommand } from './commands/company.js'

export const VERSION = '0.1.0'

const program = new Command()

program
  .name('shackleai')
  .description('ShackleAI Orchestrator — The Operating System for AI Agents')
  .version(VERSION)

program
  .command('init')
  .description('Initialize a new ShackleAI orchestrator')
  .option('--force', 'Reinitialize even if already configured')
  .action(async (opts: { force?: boolean }) => {
    await initCommand({ force: opts.force })
  })

program
  .command('start')
  .description('Start the ShackleAI orchestrator server')
  .option('-p, --port <number>', 'Port to listen on', '4800')
  .action(async (opts: { port: string }) => {
    await startCommand({ port: parseInt(opts.port, 10) })
  })

registerAgentCommand(program)
registerTaskCommand(program)
registerRunCommand(program)
registerDoctorCommand(program)
registerUpgradeCommand(program)
registerWorktreeCommand(program)
registerCompanyCommand(program)

// Only parse when run as CLI entrypoint — not when imported for VERSION etc.
const isDirectRun =
  process.argv[1]?.endsWith('index.js') ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.includes('@shackleai/orchestrator')

if (isDirectRun) {
  program.parse()
}
