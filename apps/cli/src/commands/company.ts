/**
 * `shackleai company` — List, create, switch, and inspect companies
 */

import type { Command } from 'commander'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import type { Company } from '@shackleai/shared'
import type { TemplateImportResult } from '@shackleai/core'
import type { CompanyImportResult } from '@shackleai/shared'
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

async function createCompanyFromTemplate(templateSlug: string): Promise<void> {
  p.intro(`Create company from template: ${templateSlug}`)

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

  const mission = await p.text({
    message: 'Issue prefix',
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

  const createRes = await apiClient('/api/companies', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      issue_prefix: mission.trim().toUpperCase(),
    }),
  })

  if (!createRes.ok) {
    spin.stop('Failed to create company')
    const body = (await createRes.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? createRes.statusText}`)
    process.exit(1)
  }

  const companyBody = (await createRes.json()) as ApiResponse<Company>
  const company = companyBody.data

  spin.message('Importing template...')

  const importRes = await apiClient(
    `/api/companies/${company.id}/import-template`,
    {
      method: 'POST',
      body: JSON.stringify({ slug: templateSlug }),
    },
  )

  if (!importRes.ok) {
    spin.stop('Failed to import template')
    const body = (await importRes.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? importRes.statusText}`)
    console.error(
      `Company "${company.name}" was created but template was not applied.`,
    )
    process.exit(1)
  }

  const importBody = (await importRes.json()) as ApiResponse<TemplateImportResult>
  const result = importBody.data

  spin.stop(
    `Company created: ${company.name} (${company.id})\n` +
      `  Agents: ${result.agents_created}, Goals: ${result.goals_created}, Policies: ${result.policies_created}`,
  )

  const shouldSwitch = await p.confirm({
    message: 'Switch to this company now?',
  })

  if (p.isCancel(shouldSwitch)) return

  if (shouldSwitch) {
    await switchToCompany(company)
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

async function exportCompanyCmd(opts: { output?: string }): Promise<void> {
  const companyId = await getCompanyId()
  const spin = p.spinner()
  spin.start("Exporting company...")

  const res = await apiClient("/api/companies/" + companyId + "/export", {
    method: "POST",
  })

  if (!res.ok) {
    spin.stop("Export failed")
    const body = (await res.json()) as ApiResponse<never>
    console.error("Error: " + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<Record<string, unknown>>
  const json = JSON.stringify(body.data, null, 2)

  if (opts.output) {
    const filePath = resolve(opts.output)
    await writeFile(filePath, json, "utf8")
    spin.stop("Exported to " + filePath)
  } else {
    spin.stop("Export complete")
    console.log(json)
  }
}

async function importCompanyCmd(file: string): Promise<void> {
  const filePath = resolve(file)

  let rawJson: string
  try {
    rawJson = await readFile(filePath, "utf8")
  } catch {
    console.error("Error: Could not read file " + filePath)
    process.exit(1)
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawJson) as Record<string, unknown>
  } catch {
    console.error("Error: Invalid JSON in " + filePath)
    process.exit(1)
  }

  const spin = p.spinner()
  spin.start("Importing company...")

  const res = await apiClient("/api/companies/import", {
    method: "POST",
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    spin.stop("Import failed")
    const body = (await res.json()) as ApiResponse<never>

    // Handle name collision: prompt for rename
    if (res.status === 409 && body.error?.includes("already exists")) {
      console.error(body.error)
      const newName = await p.text({
        message: "Enter a new company name",
        placeholder: (data.company as Record<string, unknown>)?.name + " (copy)",
        validate: (v) => {
          if (!v.trim()) return "Company name is required"
          return undefined
        },
      })

      if (p.isCancel(newName)) {
        p.cancel("Cancelled.")
        return
      }

      // Update the company name in the data and retry
      const companyMeta = data.company as Record<string, unknown>
      companyMeta.name = newName.trim()
      data.name = newName.trim()

      spin.start("Importing company...")
      const retryRes = await apiClient("/api/companies/import", {
        method: "POST",
        body: JSON.stringify(data),
      })

      if (!retryRes.ok) {
        spin.stop("Import failed")
        const retryBody = (await retryRes.json()) as ApiResponse<never>
        console.error("Error: " + (retryBody.error ?? retryRes.statusText))
        process.exit(1)
      }

      const retryBody = (await retryRes.json()) as ApiResponse<CompanyImportResult>
      const r = retryBody.data
      spin.stop(
        "Company imported: " + r.company.name + " (" + r.company.id + ")\n" +
        "  Agents: " + r.agents_created +
        ", Goals: " + r.goals_created +
        ", Policies: " + r.policies_created +
        ", Projects: " + r.projects_created +
        ", Issues: " + r.issues_created,
      )
      return
    }

    console.error("Error: " + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<CompanyImportResult>
  const r = body.data
  spin.stop(
    "Company imported: " + r.company.name + " (" + r.company.id + ")\n" +
    "  Agents: " + r.agents_created +
    ", Goals: " + r.goals_created +
    ", Policies: " + r.policies_created +
    ", Projects: " + r.projects_created +
    ", Issues: " + r.issues_created,
  )
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
    .option(
      '--template <slug>',
      'Create from a built-in template (e.g. software-team, startup)',
    )
    .action(async (opts: { template?: string }) => {
      if (opts.template) {
        await createCompanyFromTemplate(opts.template)
      } else {
        await createCompanyInteractive()
      }
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

  company
    .command("export")
    .description("Export current company as portable JSON")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .action(async (opts: { output?: string }) => {
      await exportCompanyCmd(opts)
    })

  company
    .command("import")
    .argument("<file>", "Path to company export JSON file")
    .description("Import a company from an export JSON file")
    .action(async (file: string) => {
      await importCompanyCmd(file)
    })
}
