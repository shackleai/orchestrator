/**
 * `shackleai secret` — Manage encrypted secrets
 */

import type { Command } from 'commander'
import { apiClient, getCompanyId } from '../api-client.js'

interface SecretListItem {
  id: string
  name: string
  created_by: string | null
  created_at: string
  updated_at: string
}

interface SecretValue {
  name: string
  value: string
}

interface ApiResponse<T> {
  data: T
  error?: string
}

async function secretSet(name: string, value: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient('/api/companies/' + companyId + '/secrets', {
    method: 'POST',
    body: JSON.stringify({ name, value }),
  })

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<SecretListItem>
  console.log("Secret '" + body.data.name + "' stored successfully.")
}

async function secretList(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient('/api/companies/' + companyId + '/secrets')

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<SecretListItem[]>

  if (body.data.length === 0) {
    console.log('No secrets found.')
    return
  }

  console.log('Secrets:')
  for (const secret of body.data) {
    const by = secret.created_by ? ' (by ' + secret.created_by + ')' : ''
    console.log('  ' + secret.name + by + '  — updated ' + secret.updated_at)
  }
}

async function secretGet(name: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient('/api/companies/' + companyId + '/secrets/' + encodeURIComponent(name))

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<SecretValue>
  console.log(body.data.value)
}

async function secretDelete(name: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    '/api/companies/' + companyId + '/secrets/' + encodeURIComponent(name),
    { method: 'DELETE' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  console.log("Secret '" + name + "' deleted.")
}

export function registerSecretCommand(program: Command): void {
  const secretCmd = program
    .command('secret')
    .description('Manage encrypted secrets')

  secretCmd
    .command('set <name> <value>')
    .description('Store an encrypted secret')
    .action(secretSet)

  secretCmd
    .command('list')
    .description('List secret names (values hidden)')
    .action(secretList)

  secretCmd
    .command('get <name>')
    .description('Decrypt and display a secret value')
    .action(secretGet)

  secretCmd
    .command('delete <name>')
    .description('Delete a secret')
    .action(secretDelete)
}
