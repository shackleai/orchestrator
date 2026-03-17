/**
 * Config management — reads/writes ~/.shackleai/orchestrator/config.json
 *
 * Supports config versioning: before each write, the current config is
 * backed up to config.{ISO-timestamp}.json in the same directory.
 */

import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface ShackleAIConfig {
  mode: 'local' | 'server'
  companyId: string
  companyName: string
  databaseUrl?: string
  dataDir?: string
  port?: number
  llmKeys?: {
    openai?: string
    anthropic?: string
  }
}

export const DEFAULT_PORT = 4800

/** Well-known keys that should NOT be redacted even though they contain "key" or "prefix". */
const SAFE_KEYS = new Set(['issue_prefix', 'dataDir', 'mode', 'companyId', 'companyName', 'port'])

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
  const baseDir = getBaseDir()
  await mkdir(baseDir, { recursive: true })

  // Backup current config before overwriting (if it exists)
  try {
    await readFile(configPath, 'utf-8')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(baseDir, `config.${timestamp}.json`)
    await copyFile(configPath, backupPath)
  } catch {
    // No existing config to backup — first write
  }

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * List config backup history — returns filenames sorted by date descending, max 10.
 */
export async function listConfigHistory(): Promise<string[]> {
  const baseDir = getBaseDir()
  try {
    const files = await readdir(baseDir)
    return files
      .filter((f) => /^config\.\d{4}-\d{2}-\d{2}T.*\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, 10)
  } catch {
    return []
  }
}

/**
 * Rollback config to the most recent backup.
 * Returns the restored config or null if no backup exists.
 */
export async function rollbackConfig(): Promise<ShackleAIConfig | null> {
  const history = await listConfigHistory()
  if (history.length === 0) {
    return null
  }

  const baseDir = getBaseDir()
  const backupPath = join(baseDir, history[0])
  const raw = await readFile(backupPath, 'utf-8')
  const config = JSON.parse(raw) as ShackleAIConfig

  // Write directly without creating another backup of the current state
  const configPath = getConfigPath()
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')

  return config
}

/**
 * Export current config with secrets redacted.
 * Replaces databaseUrl and any value whose key contains
 * secret, token, password, or key (case-insensitive) with "***REDACTED***".
 * Well-known safe keys (issue_prefix, etc.) are not redacted.
 */
export async function exportConfig(): Promise<string | null> {
  const config = await readConfig()
  if (!config) {
    return null
  }

  const sensitivePattern = /secret|token|password|key/i
  const redacted: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(config)) {
    if (k === 'databaseUrl') {
      redacted[k] = '***REDACTED***'
    } else if (!SAFE_KEYS.has(k) && sensitivePattern.test(k)) {
      redacted[k] = '***REDACTED***'
    } else {
      redacted[k] = v
    }
  }

  return JSON.stringify(redacted, null, 2)
}
