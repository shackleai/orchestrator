/**
 * `shackleai doctor` — Health checks and system diagnostics
 */

import type { Command } from 'commander'
import { WorktreeManager } from '@shackleai/core'
import { GIT_MIN_VERSION } from '@shackleai/shared'
import { readConfig, getConfigPath } from '../config.js'

const VERSION = '0.1.0'

async function runDoctor(): Promise<void> {
  console.log(`ShackleAI Orchestrator v${VERSION} — Doctor\n`)

  let allOk = true

  // 1. Check config
  const configPath = getConfigPath()
  console.log(`Config path: ${configPath}`)

  const config = await readConfig()
  if (!config) {
    console.log('[FAIL] Config not found. Run `shackleai init` first.')
    allOk = false
  } else {
    console.log('[OK]   Config loaded')
    console.log(`       Company: ${config.companyName} (${config.companyId})`)
    console.log(`       Mode:    ${config.mode}`)
  }

  // 2. Check DB connection via API health endpoint
  if (config) {
    try {
      const healthRes = await fetch('http://localhost:4800/api/health')
      if (healthRes.ok) {
        const health = (await healthRes.json()) as {
          status: string
          version: string
        }
        console.log(`[OK]   Server reachable (v${health.version})`)

        // 3. Fetch dashboard metrics for counts
        try {
          const dashRes = await fetch(
            `http://localhost:4800/api/companies/${config.companyId}/dashboard`,
          )
          if (dashRes.ok) {
            const dash = (await dashRes.json()) as {
              data: {
                agentCount: number
                taskCount: number
                openTasks: number
                completedTasks: number
              }
            }
            console.log(`[OK]   Database connected`)
            console.log(`       Agents: ${dash.data.agentCount}`)
            console.log(`       Tasks:  ${dash.data.taskCount} (${dash.data.openTasks} open, ${dash.data.completedTasks} completed)`)
          } else {
            console.log('[WARN] Could not fetch dashboard metrics')
          }
        } catch {
          console.log('[WARN] Could not fetch dashboard metrics')
        }
      } else {
        console.log('[FAIL] Server not responding correctly')
        allOk = false
      }
    } catch {
      console.log(
        '[FAIL] Server not reachable at http://localhost:4800. Is it running? (`shackleai start`)',
      )
      allOk = false
    }
  }

  // 4. Check git version (required for worktree support)
  const gitCheck = await WorktreeManager.checkGitVersion()
  if (gitCheck.ok) {
    console.log(
      `[OK]   Git ${gitCheck.version} (${GIT_MIN_VERSION}+ required for worktrees)`,
    )
  } else {
    console.log(`[FAIL] ${gitCheck.error}`)
    allOk = false
  }

  console.log('')
  if (allOk) {
    console.log('All checks passed.')
  } else {
    console.log('Some checks failed. See above for details.')
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run health checks and diagnostics')
    .action(async () => {
      await runDoctor()
    })
}
