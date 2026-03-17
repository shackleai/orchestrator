/**
 * `shackleai company` — List, create, switch, and inspect companies
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import type { Company } from '@shackleai/shared'
import { apiClient, getCompanyId } from '../api-client.js'
import { readConfig, writeConfig } from '../config.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

function formatCompanyTable(companies: Company[], currentId?: string): void {
  if (companies.length === 0) {
    console.log('No companies found.')
    return
  }

  const rows = companies.map((c) => ({
    ' ': c.id === currentId ? '*' : ' ',
    ID: c.id.slice(0, 8),
    Name: c.name,
    Status: c.status,
    Prefix: c.issue_prefix,
    Budget: `$${(c.budget_monthly_cents / 100).toFixed(2)}`,
    Created: new Date(c.created_at).toLocaleDateString(),
  }))

  console.table(rows)
}

async function fetchAllCompanies(): Promise<Company[]> {
  const res = await apiClient('/api/companies')

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Company[]>
  return body.data
}

async function listCompanies(): Promise<void> {
  const companies = await fetchAllCompanies()
  const config = await readConfig()
  formatCompanyTable(companies, config?.companyId)
}

async function createCompanyInteractive(): Promise<void> {
  p.intro('Create a new company')

  const name = await p.text({
    message: 'Company name',
    placeholder: 'Acme Corp',
    validate: (v) => {
      if (!v.trim()) return 'Company name is required'
      return undefined
    },
  })

  if (p.isCancel(name)) {
    p.cancel('Cancelled.')
    return
  }

  const description = await p.text({
    message: 'Description (optional)',
    placeholder: 'What does this company do?',
  })

  if (p.isCancel(description)) {
    p.cancel('Cancelled.')
    return
  }

  const mission = await p.text({
    message: 'Mission / issue prefix',
    placeholder: 'ACME',
    validate: (v) => {
      if (!v.trim()) return 'Issue prefix is required'
      return undefined
    },
  })

  if (p.isCancel(mission)) {
    p.cancel('Cancelled.')
    return
  }

  const spin = p.spinner()
  spin.start('Creating company...')

  const res = await apiClient('/api/companies', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      description: description?.trim() || null,
      issue_prefix: mission.trim().toUpperCase(),
    }),
  })

  if (!res.ok) {
    spin.stop('Failed to create company')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Company>
  spin.stop(`Company created: ${body.data.name} (${body.data.id})`)

  const shouldSwitch = await p.confirm({
    message: 'Switch to this company now?',
  })

  if (p.isCancel(shouldSwitch)) return

  if (shouldSwitch) {
    await switchToCompany(body.data)
  }
}

async function switchToCompany(company: Company): Promise<void> {
  const config = await readConfig()
  if (!config) {
    console.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  await writeConfig({
    ...config,
    companyId: company.id,
    companyName: company.name,
  })

  console.log(`Switched to company: ${company.name} (${company.id})`)
}

async function switchCompany(idOrName: string): Promise<void> {
  const companies = await fetchAllCompanies()

  // Try exact ID match (full or prefix)
  let match = companies.find((c) => c.id === idOrName)

  // Try ID prefix match
  if (!match) {
    match = companies.find((c) => c.id.startsWith(idOrName))
  }

  // Try case-insensitive name match
  if (!match) {
    const lower = idOrName.toLowerCase()
    match = companies.find((c) => c.name.toLowerCase() === lower)
  }

  if (!match) {
    console.error(`No company found matching "${idOrName}".`)
    console.error('Use `shackleai company list` to see available companies.')
    process.exit(1)
  }

  await switchToCompany(match)
}

async function showCurrent(): Promise<void> {
  const config = await readConfig()
  if (!config) {
    console.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  const companyId = await getCompanyId()
  const res = await apiClient(`/api/companies/${companyId}`)

  if (!res.ok) {
    // Fallback to config values if server is not running
    console.log(`Company: ${config.companyName}`)
    console.log(`ID:      ${config.companyId}`)
    return
  }

  const body = (await res.json()) as ApiResponse<Company>
  const c = body.data

  console.log(`Company: ${c.name}`)
  console.log(`ID:      ${c.id}`)
  console.log(`Status:  ${c.status}`)
  console.log(`Prefix:  ${c.issue_prefix}`)
  console.log(`Budget:  $${(c.budget_monthly_cents / 100).toFixed(2)}/mo`)
}

export function registerCompanyCommand(program: Command): void {
  const company = program
    .command('company')
    .description('Manage companies')

  company
    .command('list')
    .description('List all companies')
    .action(async () => {
      await listCompanies()
    })

  company
    .command('create')
    .description('Create a new company (interactive)')
    .action(async () => {
      await createCompanyInteractive()
    })

  company
    .command('switch')
    .argument('<id-or-name>', 'Company ID (or prefix) or name')
    .description('Switch active company')
    .action(async (idOrName: string) => {
      await switchCompany(idOrName)
    })

  company
    .command('current')
    .description('Show the current active company')
    .action(async () => {
      await showCurrent()
    })
}
