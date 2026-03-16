/**
 * Shared API client for CLI commands that call the local orchestrator server.
 */

import { readConfig } from './config.js'

const DEFAULT_PORT = 4800

export async function apiClient(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const config = await readConfig()
  if (!config) {
    console.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  const baseUrl = `http://localhost:${DEFAULT_PORT}`
  const url = path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`

  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })

  return res
}

export async function getCompanyId(): Promise<string> {
  const config = await readConfig()
  if (!config) {
    console.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }
  return config.companyId
}
