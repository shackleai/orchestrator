#!/usr/bin/env node

/**
 * @shackleai/orchestrator — CLI entrypoint
 */

import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { startCommand } from './commands/start.js'

export const VERSION = '0.1.0'

const program = new Command()

program
  .name('shackleai')
  .description('ShackleAI Orchestrator — The Operating System for AI Agents')
  .version(VERSION)

program
  .command('init')
  .description('Initialize a new ShackleAI orchestrator')
  .action(async () => {
    await initCommand()
  })

program
  .command('start')
  .description('Start the ShackleAI orchestrator server')
  .option('-p, --port <number>', 'Port to listen on', '4800')
  .action(async (opts: { port: string }) => {
    await startCommand({ port: parseInt(opts.port, 10) })
  })

program.parse()
