/**
 * `shackleai goal` — Manage goals (list, create, show)
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import { GoalLevel } from '@shackleai/shared'
import type { Goal } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatGoalTable(goals: Goal[]): void {
  if (goals.length === 0) {
    console.log('No goals found.')
    return
  }

  const rows = goals.map((g) => ({
    ID: g.id.slice(0, 8),
    Title: g.title.length > 40 ? g.title.slice(0, 37) + '...' : g.title,
    Level: g.level,
    Status: g.status,
    Owner: g.owner_agent_id ? g.owner_agent_id.slice(0, 8) : '-',
  }))

  console.table(rows)
}

async function listGoals(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/goals`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Goal[]>
  formatGoalTable(body.data)
}

async function createGoalInteractive(): Promise<void> {
  p.intro('Create a new goal')

  const title = await p.text({
    message: 'Goal title',
    placeholder: 'Increase user retention by 20%',
    validate: (v) => {
      if (!v.trim()) return 'Title is required'
      return undefined
    },
  })

  if (p.isCancel(title)) {
    p.cancel('Cancelled.')
    return
  }

  const description = await p.text({
    message: 'Description (optional)',
    placeholder: 'Detailed description of the goal',
  })

  if (p.isCancel(description)) {
    p.cancel('Cancelled.')
    return
  }

  const levelOptions = Object.entries(GoalLevel).map(([key, value]) => ({
    value,
    label: key,
  }))

  const level = await p.select({
    message: 'Goal level',
    options: levelOptions,
  })

  if (p.isCancel(level)) {
    p.cancel('Cancelled.')
    return
  }

  const companyId = await getCompanyId()
  const spin = p.spinner()
  spin.start('Creating goal...')

  const res = await apiClient(`/api/companies/${companyId}/goals`, {
    method: 'POST',
    body: JSON.stringify({
      title: title.trim(),
      description: description?.trim() || null,
      level,
    }),
  })

  if (!res.ok) {
    spin.stop('Failed to create goal')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Goal>
  spin.stop(`Goal created: ${body.data.id.slice(0, 8)} — ${body.data.title}`)
}

async function showGoal(goalId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/goals/${goalId}`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<
    Goal & { issues_count: number; projects_count: number }
  >
  const goal = body.data

  console.log('')
  console.log(`  Goal: ${goal.title}`)
  console.log(`  ID:   ${goal.id}`)
  console.log(`  Level:  ${goal.level}`)
  console.log(`  Status: ${goal.status}`)
  if (goal.description) {
    console.log(`  Description: ${goal.description}`)
  }
  if (goal.owner_agent_id) {
    console.log(`  Owner Agent: ${goal.owner_agent_id}`)
  }
  if (goal.parent_id) {
    console.log(`  Parent Goal: ${goal.parent_id}`)
  }
  console.log(`  Linked Issues:   ${goal.issues_count}`)
  console.log(`  Linked Projects: ${goal.projects_count}`)
  console.log(`  Created: ${new Date(goal.created_at).toLocaleString()}`)
  console.log('')
}

export function registerGoalCommand(program: Command): void {
  const goal = program.command('goal').description('Manage goals')

  goal
    .command('list')
    .description('List all goals')
    .action(async () => {
      await listGoals()
    })

  goal
    .command('create')
    .description('Create a new goal (interactive)')
    .action(async () => {
      await createGoalInteractive()
    })

  goal
    .command('show')
    .argument('<goalId>', 'Goal ID')
    .description('Show goal details')
    .action(async (goalId: string) => {
      await showGoal(goalId)
    })
}
