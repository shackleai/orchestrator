/**
 * `shackleai run <agentId>` — Trigger on-demand agent wakeup/heartbeat
 */

import type { Command } from 'commander'
import type { Agent } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface WakeupResponse {
  data: {
    agent: Agent
    triggered: boolean
  }
  error?: string
}

async function runAgent(agentId: string): Promise<void> {
  const companyId = await getCompanyId()

  console.log(`Triggering wakeup for agent ${agentId}...`)

  const res = await apiClient(
    `/api/companies/${companyId}/agents/${agentId}/wakeup`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as { error?: string }
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as WakeupResponse
  const { agent, triggered } = body.data

  console.log(`Triggered: ${triggered}`)
  console.log(`Agent:     ${agent.name} (${agent.id})`)
  console.log(`Status:    ${agent.status}`)
  console.log(
    `Heartbeat: ${agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).toLocaleString() : '-'}`,
  )
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .argument('<agentId>', 'Agent ID to trigger')
    .description('Trigger an on-demand agent wakeup')
    .action(async (agentId: string) => {
      await runAgent(agentId)
    })
}
