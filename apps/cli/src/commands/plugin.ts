/**
 * `shackleai plugin` — Manage plugins
 */

import type { Command } from 'commander'
import { apiClient, getCompanyId } from '../api-client.js'

interface PluginInfo {
  name: string
  version: string
  status: string
  error_message: string | null
  installed_at: string
}

interface ApiResponse<T> {
  data: T
  error?: string
}

async function pluginList(): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient('/api/companies/' + companyId + '/plugins')

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<PluginInfo[]>

  if (body.data.length === 0) {
    console.log('No plugins installed.')
    return
  }

  console.log('Installed plugins:')
  for (const p of body.data) {
    const err = p.error_message ? ` (error: ${p.error_message})` : ''
    console.log(`  ${p.name}@${p.version}  [${p.status}]${err}  — installed ${p.installed_at}`)
  }
}

async function pluginInstall(source: string, opts: { config?: string }): Promise<void> {
  const companyId = await getCompanyId()

  let config: Record<string, unknown> = {}
  if (opts.config) {
    try {
      config = JSON.parse(opts.config) as Record<string, unknown>
    } catch {
      console.error('Error: --config must be valid JSON')
      process.exit(1)
    }
  }

  const res = await apiClient('/api/companies/' + companyId + '/plugins', {
    method: 'POST',
    body: JSON.stringify({ source, config }),
  })

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<PluginInfo>
  console.log(`Plugin '${body.data.name}@${body.data.version}' installed [${body.data.status}].`)
}

async function pluginRemove(name: string): Promise<void> {
  const companyId = await getCompanyId()
  const res = await apiClient(
    '/api/companies/' + companyId + '/plugins/' + encodeURIComponent(name),
    { method: 'DELETE' },
  )

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error('Error: ' + (body.error ?? res.statusText))
    process.exit(1)
  }

  console.log(`Plugin '${name}' removed.`)
}

export function registerPluginCommand(program: Command): void {
  const pluginCmd = program
    .command('plugin')
    .description('Manage plugins')

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .action(pluginList)

  pluginCmd
    .command('install <source>')
    .description('Install a plugin (npm package name or path)')
    .option('--config <json>', 'Plugin configuration as JSON')
    .action(pluginInstall)

  pluginCmd
    .command('remove <name>')
    .description('Uninstall a plugin')
    .action(pluginRemove)
}
