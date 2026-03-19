/**
 * `shackleai worktree` — Manage agent git worktrees
 */

import type { Command } from 'commander'
import type { AgentWorktree, WorktreeInfo, CleanupResult } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

interface WorktreeWithAgent extends AgentWorktree {
  agent_name?: string
}

function formatWorktreeTable(worktrees: WorktreeWithAgent[]): void {
  if (worktrees.length === 0) {
    console.log('No worktrees found.')
    return
  }

  const rows = worktrees.map((w) => ({
    ID: w.id.slice(0, 8),
    Agent: w.agent_name ?? w.agent_id.slice(0, 8),
    Branch: w.branch,
    Base: w.base_branch,
    Status: w.status,
    Path: w.worktree_path,
    'Last Used': w.last_used_at
      ? new Date(w.last_used_at).toLocaleString()
      : '-',
  }))

  console.table(rows)
}

async function listWorktrees(options: { agent?: string }): Promise<void> {
  const companyId = await getCompanyId()

  if (options.agent) {
    const res = await apiClient(
      `/api/companies/${companyId}/agents/${options.agent}/worktrees`,
    )

    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<never>
      console.error(`Error: ${body.error ?? res.statusText}`)
      process.exit(1)
    }

    const body = (await res.json()) as ApiResponse<AgentWorktree[]>
    formatWorktreeTable(body.data)
    return
  }

  // List all worktrees across all agents — single company-level query
  const res = await apiClient(`/api/companies/${companyId}/worktrees`)
  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<WorktreeWithAgent[]>
  formatWorktreeTable(body.data)
}

async function createWorktree(
  agentId: string,
  branch: string,
  options: { base?: string; repo?: string; issue?: string },
): Promise<void> {
  const companyId = await getCompanyId()

  const body: Record<string, unknown> = {
    branch,
    repo_path: options.repo ?? process.cwd(),
  }

  if (options.base) {
    body.base_branch = options.base
  }

  if (options.issue) {
    body.issue_id = options.issue
  }

  const res = await apiClient(
    `/api/companies/${companyId}/agents/${agentId}/worktrees`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const resBody = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${resBody.error ?? res.statusText}`)
    process.exit(1)
  }

  const resBody = (await res.json()) as ApiResponse<WorktreeInfo>
  console.log(`Worktree created:`)
  console.log(`  Branch: ${resBody.data.branch}`)
  console.log(`  Path:   ${resBody.data.path}`)
  console.log(`  Base:   ${resBody.data.baseBranch}`)
}

async function cleanupWorktrees(options: {
  dryRun?: boolean
  maxAge?: string
}): Promise<void> {
  const companyId = await getCompanyId()

  const body: Record<string, unknown> = {}
  if (options.dryRun) {
    body.dry_run = true
  }
  if (options.maxAge) {
    body.max_age_ms = parseDuration(options.maxAge)
  }

  const res = await apiClient(
    `/api/companies/${companyId}/worktrees/cleanup`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const resBody = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${resBody.error ?? res.statusText}`)
    process.exit(1)
  }

  const resBody = (await res.json()) as ApiResponse<CleanupResult>
  const r = resBody.data

  if (options.dryRun) {
    console.log('[DRY RUN] No changes made.')
  }

  console.log(`Removed:  ${r.removed.length}`)
  for (const p of r.removed) console.log(`  - ${p}`)

  console.log(`Stashed:  ${r.stashed.length}`)
  for (const p of r.stashed) console.log(`  - ${p}`)

  console.log(`Skipped:  ${r.skipped.length}`)
  for (const p of r.skipped) console.log(`  - ${p}`)
}

async function worktreeStatus(agentId: string): Promise<void> {
  const companyId = await getCompanyId()

  const res = await apiClient(
    `/api/companies/${companyId}/agents/${agentId}/worktrees`,
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<AgentWorktree[]>

  if (body.data.length === 0) {
    console.log(`No worktrees for agent ${agentId.slice(0, 8)}.`)
    return
  }

  for (const w of body.data) {
    console.log(`\nWorktree: ${w.branch}`)
    console.log(`  ID:     ${w.id}`)
    console.log(`  Status: ${w.status}`)
    console.log(`  Path:   ${w.worktree_path}`)
    console.log(`  Base:   ${w.base_branch}`)
    console.log(
      `  Last:   ${w.last_used_at ? new Date(w.last_used_at).toLocaleString() : '-'}`,
    )
  }
}

/**
 * Parse a duration string like "7d", "24h", "30m" into milliseconds.
 */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)\s*(d|h|m|s)$/i)
  if (!match) {
    console.error(`Invalid duration format: ${input}. Use e.g. "7d", "24h", "30m".`)
    process.exit(1)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]
}

export function registerWorktreeCommand(program: Command): void {
  const worktree = program
    .command('worktree')
    .description('Manage agent git worktrees')

  worktree
    .command('list')
    .description('List worktrees')
    .option('--agent <id>', 'Filter by agent ID')
    .action(async (options: { agent?: string }) => {
      await listWorktrees(options)
    })

  worktree
    .command('create')
    .argument('<agentId>', 'Agent ID')
    .argument('<branch>', 'Branch name')
    .option('--base <branch>', 'Base branch (default: main)')
    .option('--repo <path>', 'Repository path (default: cwd)')
    .option('--issue <id>', 'Issue ID to associate')
    .description('Create a new worktree for an agent')
    .action(
      async (
        agentId: string,
        branch: string,
        options: { base?: string; repo?: string; issue?: string },
      ) => {
        await createWorktree(agentId, branch, options)
      },
    )

  worktree
    .command('cleanup')
    .description('Clean up stale or orphaned worktrees')
    .option('--dry-run', 'Preview cleanup without making changes')
    .option('--max-age <duration>', 'Max age before cleanup (e.g. 7d)')
    .action(async (options: { dryRun?: boolean; maxAge?: string }) => {
      await cleanupWorktrees(options)
    })

  worktree
    .command('status')
    .argument('<agentId>', 'Agent ID')
    .description('Show worktree status for an agent')
    .action(async (agentId: string) => {
      await worktreeStatus(agentId)
    })
}
