/**
 * Shared API client for CLI commands that call the local orchestrator server.
 */

import { readConfig, DEFAULT_PORT } from './config.js'

export async function apiClient(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const config = await readConfig()
  if (!config) {
    console.error('Not initialized. Run `shackleai init` first.')
    process.exit(1)
  }

  const port = config.port ?? DEFAULT_PORT
  const baseUrl = `http://127.0.0.1:${port}`
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
