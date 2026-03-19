/**
 * `shackleai quota` -- Manage time-windowed provider quotas
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import type { QuotaWindow, QuotaStatus } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatQuotaTable(quotas: QuotaWindow[]): void {
  if (quotas.length === 0) {
    console.log('No quota windows configured.')
    return
  }
  const rows = quotas.map((q) => ({
    ID: q.id.slice(0, 8),
    Agent: q.agent_id?.slice(0, 8) ?? '(all)',
    Provider: q.provider ?? '(all)',
    Window: q.window_duration,
    'Max Requests': q.max_requests ?? '-',
    'Max Tokens': q.max_tokens ?? '-',
    Created: new Date(q.created_at).toLocaleString(),
  }))
  console.table(rows)
}

async function listQuotas(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/quotas`)
  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }
  const body = (await res.json()) as ApiResponse<QuotaWindow[]>
  formatQuotaTable(body.data)
}

async function createQuotaInteractive(): Promise<void> {
  p.intro('Create a quota window')

  const provider = await p.text({
    message: 'Provider (leave empty for all providers)',
    placeholder: 'anthropic',
  })
  if (p.isCancel(provider)) { p.cancel('Cancelled.'); return }

  const windowDuration = await p.select({
    message: 'Window duration',
    options: [
      { value: '1m', label: '1 minute' },
      { value: '5m', label: '5 minutes' },
      { value: '15m', label: '15 minutes' },
      { value: '1h', label: '1 hour' },
      { value: '6h', label: '6 hours' },
      { value: '1d', label: '1 day' },
    ],
  })
  if (p.isCancel(windowDuration)) { p.cancel('Cancelled.'); return }

  const maxRequests = await p.text({
    message: 'Max requests (leave empty for no limit)',
    placeholder: '100',
  })
  if (p.isCancel(maxRequests)) { p.cancel('Cancelled.'); return }

  const maxTokens = await p.text({
    message: 'Max tokens (leave empty for no limit)',
    placeholder: '1000000',
  })
  if (p.isCancel(maxTokens)) { p.cancel('Cancelled.'); return }

  const parsedRequests = maxRequests?.trim() ? parseInt(maxRequests.trim(), 10) : undefined
  const parsedTokens = maxTokens?.trim() ? parseInt(maxTokens.trim(), 10) : undefined

  if (parsedRequests === undefined && parsedTokens === undefined) {
    p.cancel('At least one of max requests or max tokens must be set.')
    return
  }

  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/quotas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: provider?.trim() || null,
      window_duration: windowDuration,
      max_requests: parsedRequests ?? null,
      max_tokens: parsedTokens ?? null,
    }),
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }
  const body = (await res.json()) as ApiResponse<QuotaWindow>
  p.outro(`Quota window created: ${body.data.id.slice(0, 8)}`)
}

async function deleteQuota(quotaId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/quotas/${quotaId}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }
  console.log(`Quota window ${quotaId} deleted.`)
}

async function showStatus(agentId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/agents/${agentId}/quota-status`)
  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }
  const body = (await res.json()) as ApiResponse<QuotaStatus[]>
  if (body.data.length === 0) {
    console.log('No quota windows apply to this agent.')
    return
  }
  const rows = body.data.map((s) => ({
    'Quota ID': s.quota.id.slice(0, 8),
    Provider: s.quota.provider ?? '(all)',
    Window: s.quota.window_duration,
    Requests: `${s.current_requests}/${s.quota.max_requests ?? '-'}`,
    Tokens: `${s.current_tokens}/${s.quota.max_tokens ?? '-'}`,
    Exceeded: s.exceeded ? 'YES' : 'no',
  }))
  console.table(rows)
}

export function registerQuotaCommand(program: Command): void {
  const cmd = program.command('quota').description('Manage time-windowed provider quotas')

  cmd.command('list').description('List quota windows').action(async () => { await listQuotas() })
  cmd.command('create').description('Create a quota window (interactive)').action(async () => { await createQuotaInteractive() })
  cmd.command('delete <id>').description('Delete a quota window').action(async (id: string) => { await deleteQuota(id) })
  cmd.command('status <agentId>').description('Show quota usage for an agent').action(async (agentId: string) => { await showStatus(agentId) })
}
