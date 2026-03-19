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
import { registerGoalCommand } from './commands/goal.js'
import { registerProjectCommand } from './commands/project.js'
import { registerCompanyCommand } from './commands/company.js'
import { registerCommentCommand } from './commands/comment.js'
import { registerConfigCommand } from './commands/config-cmd.js'
import { registerApprovalCommand } from './commands/approval.js'
import { registerSecretCommand } from './commands/secret.js'
import { registerQuotaCommand } from './commands/quota.js'
import { handleError, setVerbose } from './errors.js'

export const VERSION = '0.1.0'

const program = new Command()

program
  .name('shackleai')
  .description('ShackleAI Orchestrator — The Operating System for AI Agents')
  .version(VERSION)
  .option('--verbose', 'Show full stack traces on errors')
  .hook('preAction', () => {
    setVerbose(program.opts().verbose === true)
  })

program
  .command('init')
  .description('Initialize a new ShackleAI orchestrator')
  .option('--force', 'Reinitialize even if already configured')
  .option('--yes', 'Non-interactive mode with defaults')
  .option('--name <name>', 'Company name (required with --yes)')
  .action(async (opts: { force?: boolean; yes?: boolean; name?: string }) => {
    await initCommand({ force: opts.force, yes: opts.yes, name: opts.name })
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
registerGoalCommand(program)
registerProjectCommand(program)
registerCompanyCommand(program)
registerCommentCommand(program)
registerConfigCommand(program)
registerApprovalCommand(program)
registerSecretCommand(program)
registerQuotaCommand(program)

// Only parse when run as CLI entrypoint — not when imported for VERSION etc.
const isDirectRun =
  process.argv[1]?.endsWith('index.js') ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.includes('@shackleai/orchestrator')

if (isDirectRun) {
  // Global error handlers — catch unhandled rejections and exceptions
  process.on('unhandledRejection', (reason) => {
    handleError(reason)
  })

  process.on('uncaughtException', (err) => {
    handleError(err)
  })

  program.parseAsync().catch(handleError)
}
