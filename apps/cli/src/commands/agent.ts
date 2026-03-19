/**
 * `shackleai agent` — Manage agents (list, create, pause, resume, terminate)
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import { AdapterType, AgentRole } from '@shackleai/shared'
import type { Agent, AgentConfigRevision } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatAgentTable(agents: Agent[]): void {
  if (agents.length === 0) {
    console.log('No agents found.')
    return
  }

  const rows = agents.map((a) => ({
    ID: a.id.slice(0, 8),
    Name: a.name,
    Role: a.role,
    Status: a.status,
    Adapter: a.adapter_type,
    'Last Heartbeat': a.last_heartbeat_at
      ? new Date(a.last_heartbeat_at).toLocaleString()
      : '-',
  }))

  console.table(rows)
}

async function listAgents(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/agents`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Agent[]>
  formatAgentTable(body.data)
}

async function createAgentInteractive(): Promise<void> {
  p.intro('Create a new agent')

  const name = await p.text({
    message: 'Agent name',
    placeholder: 'coder-bot',
    validate: (v) => {
      if (!v.trim()) return 'Agent name is required'
      return undefined
    },
  })

  if (p.isCancel(name)) {
    p.cancel('Cancelled.')
    return
  }

  const roleOptions = Object.entries(AgentRole).map(([key, value]) => ({
    value,
    label: key,
  }))

  const role = await p.select({
    message: 'Agent role',
    options: roleOptions,
  })

  if (p.isCancel(role)) {
    p.cancel('Cancelled.')
    return
  }

  const adapterOptions = Object.entries(AdapterType).map(([key, value]) => ({
    value,
    label: key,
  }))

  const adapterType = await p.select({
    message: 'Adapter type',
    options: adapterOptions,
  })

  if (p.isCancel(adapterType)) {
    p.cancel('Cancelled.')
    return
  }

  const companyId = await getCompanyId()
  const spin = p.spinner()
  spin.start('Creating agent...')

  const res = await apiClient(`/api/companies/${companyId}/agents`, {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      role,
      adapter_type: adapterType,
    }),
  })

  if (!res.ok) {
    spin.stop('Failed to create agent')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Agent>
  spin.stop(`Agent created: ${body.data.name} (${body.data.id})`)
}

async function pauseAgent(id: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/agents/${id}/pause`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Agent>
  console.log(`Agent ${body.data.name} paused.`)
}

async function resumeAgent(id: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/agents/${id}/resume`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Agent>
  console.log(`Agent ${body.data.name} resumed.`)
}

async function terminateAgent(id: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/agents/${id}/terminate`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Agent>
  console.log(`Agent ${body.data.name} terminated.`)
}


function formatRevisionTable(revisions: AgentConfigRevision[]): void {
  if (revisions.length === 0) {
    console.log('No revisions found.')
    return
  }

  const rows = revisions.map((r) => ({
    ID: r.id.slice(0, 8),
    Rev: r.revision_number,
    'Changed By': r.changed_by ?? '-',
    Reason: r.change_reason ? r.change_reason.slice(0, 40) : '-',
    'Created At': new Date(r.created_at).toLocaleString(),
  }))

  console.table(rows)
}

async function listRevisions(agentId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/agents/${agentId}/revisions`,
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<AgentConfigRevision[]>
  formatRevisionTable(body.data)
}

async function rollbackAgent(agentId: string, revisionId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/agents/${agentId}/rollback/${revisionId}`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<{ agent: Agent; rolled_back_to: number }>
  console.log(`Agent ${body.data.agent.name} rolled back to revision ${body.data.rolled_back_to}.`)
}

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agents')

  agent
    .command('list')
    .description('List all agents')
    .action(async () => {
      await listAgents()
    })

  agent
    .command('create')
    .description('Create a new agent (interactive)')
    .action(async () => {
      await createAgentInteractive()
    })

  agent
    .command('pause')
    .argument('<id>', 'Agent ID')
    .description('Pause an agent')
    .action(async (id: string) => {
      await pauseAgent(id)
    })

  agent
    .command('resume')
    .argument('<id>', 'Agent ID')
    .description('Resume a paused agent')
    .action(async (id: string) => {
      await resumeAgent(id)
    })

  agent
    .command('terminate')
    .argument('<id>', 'Agent ID')
    .description('Terminate an agent')
    .action(async (id: string) => {
      await terminateAgent(id)
    })


  agent
    .command('revisions')
    .argument('<agentId>', 'Agent ID')
    .description('List config revisions for an agent')
    .action(async (agentId: string) => {
      await listRevisions(agentId)
    })

  agent
    .command('rollback')
    .argument('<agentId>', 'Agent ID')
    .argument('<revisionId>', 'Revision ID to rollback to')
    .description('Rollback agent config to a previous revision')
    .action(async (agentId: string, revisionId: string) => {
      await rollbackAgent(agentId, revisionId)
    })
}
