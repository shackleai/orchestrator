/**
 * `shackleai doctor` — Health checks and system diagnostics
 */

import type { Command } from 'commander'
import { WorktreeManager, AdapterRegistry, getAdapterFixInstructions } from '@shackleai/core'
import { GIT_MIN_VERSION } from '@shackleai/shared'
import type { Agent } from '@shackleai/shared'
import { readConfig, getConfigPath, DEFAULT_PORT } from '../config.js'
import { apiClient, getCompanyId } from '../api-client.js'
import { VERSION } from '../index.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

/**
 * Check adapter health for all adapter types in use by agents.
 * Queries agents from the API, collects unique adapter types,
 * and runs testEnvironment() for each.
 */
async function checkAdapterHealth(): Promise<boolean> {
  console.log('\n--- Adapter Health ---')

  let companyId: string
  try {
    companyId = await getCompanyId()
  } catch {
    console.log('[SKIP] Could not determine company ID — skipping adapter checks')
    return true
  }

  // Fetch agents to determine which adapters are in use
  let agents: Agent[]
  try {
    const res = await apiClient(`/api/companies/${companyId}/agents`)
    if (!res.ok) {
      console.log('[SKIP] Could not fetch agents — skipping adapter checks')
      return true
    }
    const body = (await res.json()) as ApiResponse<Agent[]>
    agents = body.data
  } catch {
    console.log('[SKIP] Could not fetch agents — skipping adapter checks')
    return true
  }

  if (agents.length === 0) {
    console.log('[SKIP] No agents configured — skipping adapter checks')
    return true
  }

  // Collect unique adapter types in use
  const adapterTypesInUse = [...new Set(agents.map((a) => a.adapter_type))]
  console.log(`       Checking ${adapterTypesInUse.length} adapter type(s) in use: ${adapterTypesInUse.join(', ')}`)

  const registry = new AdapterRegistry()
  let allOk = true

  for (const adapterType of adapterTypesInUse) {
    const adapter = registry.get(adapterType)
    if (!adapter) {
      console.log(`[WARN] Unknown adapter type: ${adapterType}`)
      continue
    }

    if (!adapter.testEnvironment) {
      console.log(`[OK]   ${adapter.label} (${adapterType}) — no environment check available`)
      continue
    }

    try {
      const result = await adapter.testEnvironment()
      if (result.ok) {
        console.log(`[OK]   ${adapter.label} (${adapterType})`)
      } else {
        const fix = getAdapterFixInstructions(adapterType)
        console.log(`[FAIL] ${adapter.label} (${adapterType}): ${result.error}`)
        console.log(`       Fix: ${fix.split('\n')[0]}`)
        allOk = false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[FAIL] ${adapter.label} (${adapterType}): ${msg}`)
      allOk = false
    }
  }

  return allOk
}

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
    const port = config.port ?? DEFAULT_PORT
    const baseUrl = `http://127.0.0.1:${port}`
    try {
      const healthRes = await fetch(`${baseUrl}/api/health`)
      if (healthRes.ok) {
        const health = (await healthRes.json()) as {
          status: string
          version: string
        }
        console.log(`[OK]   Server reachable (v${health.version})`)

        // 3. Fetch dashboard metrics for counts
        try {
          const dashRes = await fetch(
            `${baseUrl}/api/companies/${config.companyId}/dashboard`,
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
        `[FAIL] Server not reachable at ${baseUrl}. Is it running? (\`shackleai start\`)`,
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

  // 5. Check adapter health (only for adapters in use by agents)
  const adapterOk = await checkAdapterHealth()
  if (!adapterOk) {
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
