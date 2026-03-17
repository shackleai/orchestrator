/**
 * Config management — reads/writes ~/.shackleai/orchestrator/config.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface ShackleAIConfig {
  mode: 'local' | 'server'
  companyId: string
  companyName: string
  databaseUrl?: string
  dataDir?: string
  port?: number
}

export const DEFAULT_PORT = 4800

/** Base directory for orchestrator data — namespaced under .shackleai/orchestrator/ */
export function getBaseDir(): string {
  return join(homedir(), '.shackleai', 'orchestrator')
}

export function getConfigPath(): string {
  return join(getBaseDir(), 'config.json')
}

export async function readConfig(): Promise<ShackleAIConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as ShackleAIConfig
  } catch {
    return null
  }
}

export async function writeConfig(config: ShackleAIConfig): Promise<void> {
  const configPath = getConfigPath()
  await mkdir(getBaseDir(), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
