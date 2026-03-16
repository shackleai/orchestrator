/**
 * `shackleai task` — Manage tasks/issues (list, create, assign, complete)
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import { IssuePriority } from '@shackleai/shared'
import type { Issue } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatTaskTable(tasks: Issue[]): void {
  if (tasks.length === 0) {
    console.log('No tasks found.')
    return
  }

  const rows = tasks.map((t) => ({
    ID: t.id.slice(0, 8),
    Identifier: t.identifier,
    Title: t.title.length > 40 ? t.title.slice(0, 37) + '...' : t.title,
    Status: t.status,
    Priority: t.priority,
    Assignee: t.assignee_agent_id ? t.assignee_agent_id.slice(0, 8) : '-',
  }))

  console.table(rows)
}

async function listTasks(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/issues`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Issue[]>
  formatTaskTable(body.data)
}

async function createTaskInteractive(): Promise<void> {
  p.intro('Create a new task')

  const title = await p.text({
    message: 'Task title',
    placeholder: 'Implement feature X',
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
    placeholder: 'Detailed description of the task',
  })

  if (p.isCancel(description)) {
    p.cancel('Cancelled.')
    return
  }

  const priorityOptions = Object.entries(IssuePriority).map(
    ([key, value]) => ({
      value,
      label: key,
    }),
  )

  const priority = await p.select({
    message: 'Priority',
    options: priorityOptions,
  })

  if (p.isCancel(priority)) {
    p.cancel('Cancelled.')
    return
  }

  const companyId = await getCompanyId()
  const spin = p.spinner()
  spin.start('Creating task...')

  const res = await apiClient(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: title.trim(),
      description: description?.trim() || null,
      priority,
    }),
  })

  if (!res.ok) {
    spin.stop('Failed to create task')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Issue>
  spin.stop(`Task created: ${body.data.identifier} — ${body.data.title}`)
}

async function assignTask(taskId: string, agentId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/issues/${taskId}/checkout`,
    {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Issue>
  console.log(
    `Task ${body.data.identifier} assigned to agent ${agentId.slice(0, 8)}. Status: ${body.data.status}`,
  )
}

async function completeTask(taskId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    `/api/companies/${companyId}/issues/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Issue>
  console.log(`Task ${body.data.identifier} marked as done.`)
}

export function registerTaskCommand(program: Command): void {
  const task = program
    .command('task')
    .description('Manage tasks')

  task
    .command('list')
    .description('List all tasks')
    .action(async () => {
      await listTasks()
    })

  task
    .command('create')
    .description('Create a new task (interactive)')
    .action(async () => {
      await createTaskInteractive()
    })

  task
    .command('assign')
    .argument('<taskId>', 'Task ID')
    .argument('<agentId>', 'Agent ID to assign')
    .description('Assign a task to an agent')
    .action(async (taskId: string, agentId: string) => {
      await assignTask(taskId, agentId)
    })

  task
    .command('complete')
    .argument('<taskId>', 'Task ID')
    .description('Mark a task as done')
    .action(async (taskId: string) => {
      await completeTask(taskId)
    })
}
