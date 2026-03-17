/**
 * `shackleai project` — Manage projects (list, create, show)
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import type { Project } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatProjectTable(projects: Project[]): void {
  if (projects.length === 0) {
    console.log('No projects found.')
    return
  }

  const rows = projects.map((proj) => ({
    ID: proj.id.slice(0, 8),
    Name: proj.name.length > 40 ? proj.name.slice(0, 37) + '...' : proj.name,
    Status: proj.status,
    Goal: proj.goal_id ? proj.goal_id.slice(0, 8) : '-',
    Lead: proj.lead_agent_id ? proj.lead_agent_id.slice(0, 8) : '-',
    Target: proj.target_date ?? '-',
  }))

  console.table(rows)
}

async function listProjects(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/projects`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Project[]>
  formatProjectTable(body.data)
}

async function createProjectInteractive(): Promise<void> {
  p.intro('Create a new project')

  const name = await p.text({
    message: 'Project name',
    placeholder: 'Q1 Platform Launch',
    validate: (v) => {
      if (!v.trim()) return 'Name is required'
      return undefined
    },
  })

  if (p.isCancel(name)) {
    p.cancel('Cancelled.')
    return
  }

  const description = await p.text({
    message: 'Description (optional)',
    placeholder: 'Detailed description of the project',
  })

  if (p.isCancel(description)) {
    p.cancel('Cancelled.')
    return
  }

  const targetDate = await p.text({
    message: 'Target date (optional, YYYY-MM-DD)',
    placeholder: '2026-06-30',
  })

  if (p.isCancel(targetDate)) {
    p.cancel('Cancelled.')
    return
  }

  const companyId = await getCompanyId()
  const spin = p.spinner()
  spin.start('Creating project...')

  const res = await apiClient(`/api/companies/${companyId}/projects`, {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      description: description?.trim() || null,
      target_date: targetDate?.trim() || null,
    }),
  })

  if (!res.ok) {
    spin.stop('Failed to create project')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Project>
  spin.stop(`Project created: ${body.data.id.slice(0, 8)} — ${body.data.name}`)
}

async function showProject(projectId: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}/projects/${projectId}`)

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<
    Project & { goal_title: string | null; goal_level: string | null; issues_count: number }
  >
  const proj = body.data

  console.log('')
  console.log(`  Project: ${proj.name}`)
  console.log(`  ID:      ${proj.id}`)
  console.log(`  Status:  ${proj.status}`)
  if (proj.description) {
    console.log(`  Description: ${proj.description}`)
  }
  if (proj.goal_title) {
    console.log(`  Goal: ${proj.goal_title} (${proj.goal_level})`)
  }
  if (proj.lead_agent_id) {
    console.log(`  Lead Agent: ${proj.lead_agent_id}`)
  }
  if (proj.target_date) {
    console.log(`  Target Date: ${proj.target_date}`)
  }
  console.log(`  Linked Issues: ${proj.issues_count}`)
  console.log(`  Created: ${new Date(proj.created_at).toLocaleString()}`)
  console.log('')
}

export function registerProjectCommand(program: Command): void {
  const project = program.command('project').description('Manage projects')

  project
    .command('list')
    .description('List all projects')
    .action(async () => {
      await listProjects()
    })

  project
    .command('create')
    .description('Create a new project (interactive)')
    .action(async () => {
      await createProjectInteractive()
    })

  project
    .command('show')
    .argument('<projectId>', 'Project ID')
    .description('Show project details')
    .action(async (projectId: string) => {
      await showProject(projectId)
    })
}
