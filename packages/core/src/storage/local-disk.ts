/**
 * Local disk storage provider.
 *
 * Stores files under ~/.shackleai/orchestrator/storage/ by default.
 * Keys map directly to file paths within the base directory.
 */

import { mkdir, readFile, writeFile, unlink, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { StorageProvider, UploadResult, DownloadResult, LocalDiskConfig } from './provider.js'

const DEFAULT_BASE_PATH = join(homedir(), '.shackleai', 'orchestrator', 'storage')

export class LocalDiskProvider implements StorageProvider {
  readonly type = 'local-disk' as const
  private readonly basePath: string

  constructor(config: Omit<LocalDiskConfig, 'type'> = {}) {
    this.basePath = config.basePath ?? DEFAULT_BASE_PATH
  }

  async upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult> {
    const filePath = this.resolve(key)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, buffer)

    // Store mime type in a sidecar .meta file
    await writeFile(`${filePath}.meta`, JSON.stringify({ mime, size: buffer.length }))

    return { key, size: buffer.length, mime }
  }

  async download(key: string): Promise<DownloadResult> {
    const filePath = this.resolve(key)
    const buffer = await readFile(filePath)
    const meta = await this.readMeta(filePath)

    return {
      buffer,
      mime: meta?.mime ?? 'application/octet-stream',
      size: buffer.length,
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key)
    try {
      await unlink(filePath)
      await unlink(`${filePath}.meta`).catch(() => {})
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return
      throw err
    }
  }

  async getUrl(key: string): Promise<string> {
    const filePath = this.resolve(key)
    return pathToFileURL(filePath).href
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }

  /** Resolve a key to an absolute file path, preventing path traversal. */
  private resolve(key: string): string {
    // Normalize: strip leading slashes, reject '..' segments
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '')
    if (normalized.includes('..')) {
      throw new Error(`Invalid storage key: path traversal detected in "${key}"`)
    }
    return join(this.basePath, ...normalized.split('/'))
  }

  private async readMeta(filePath: string): Promise<{ mime: string; size: number } | null> {
    try {
      const raw = await readFile(`${filePath}.meta`, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
