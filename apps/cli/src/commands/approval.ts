/**
 * `shackleai approval` — Manage approval workflows
 */

import type { Command } from 'commander'
import type { Approval } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

async function listApprovals(options: { status?: string }): Promise<void> {
  const companyId = await getCompanyId()
  const params = options.status ? `?status=${options.status}` : ''
  const res = await apiClient(`/api/companies/${companyId}/approvals${params}`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Approval[]>

  if (body.data.length === 0) {
    console.log('No approvals found.')
    return
  }

  const rows = body.data.map((a) => ({
    ID: a.id.slice(0, 8),
    Type: a.type,
    Status: a.status,
    'Requested By': a.requested_by ?? '-',
    'Decided By': a.decided_by ?? '-',
    Created: new Date(a.created_at).toLocaleString(),
  }))

  console.table(rows)
}

async function approveApproval(approvalId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/approvals/${approvalId}/approve`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  console.log(`Approval ${approvalId} approved.`)
}

async function rejectApproval(approvalId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/approvals/${approvalId}/reject`,
    { method: 'POST' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  console.log(`Approval ${approvalId} rejected.`)
}

export function registerApprovalCommand(program: Command): void {
  const cmd = program
    .command('approval')
    .description('Manage approval workflows')

  cmd
    .command('list')
    .description('List approvals')
    .option('--status <status>', 'Filter by status (pending, approved, rejected)')
    .action(async (opts: { status?: string }) => {
      await listApprovals(opts)
    })

  cmd
    .command('approve <id>')
    .description('Approve a pending request')
    .action(async (id: string) => {
      await approveApproval(id)
    })

  cmd
    .command('reject <id>')
    .description('Reject a pending request')
    .action(async (id: string) => {
      await rejectApproval(id)
    })
}
