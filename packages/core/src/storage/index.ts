/**
 * Storage abstraction — pluggable file storage backends.
 *
 * Usage:
 *   import { createStorageProvider } from '@shackleai/core'
 *
 *   const storage = createStorageProvider({ type: 'local-disk' })
 *   await storage.upload('uploads/logo.png', buffer, 'image/png')
 */

export type {
  StorageProvider,
  StorageConfig,
  LocalDiskConfig,
  S3Config,
  UploadResult,
  DownloadResult,
} from './provider.js'

export { LocalDiskProvider } from './local-disk.js'
export { S3Provider } from './s3.js'

import type { StorageConfig, StorageProvider } from './provider.js'
import { LocalDiskProvider } from './local-disk.js'
import { S3Provider } from './s3.js'

/**
 * Factory: create a storage provider from configuration.
 *
 * @example
 *   // Local disk (default)
 *   const local = createStorageProvider({ type: 'local-disk' })
 *
 *   // S3
 *   const s3 = createStorageProvider({
 *     type: 's3',
 *     bucket: 'my-bucket',
 *     region: 'us-east-1',
 *     accessKeyId: '...',
 *     secretAccessKey: '...',
 *   })
 */
export function createStorageProvider(config: StorageConfig): StorageProvider {
  switch (config.type) {
    case 'local-disk': {
      const { type: _, ...rest } = config
      return new LocalDiskProvider(rest)
    }
    case 's3': {
      const { type: _, ...rest } = config
      return new S3Provider(rest)
    }
    default:
      throw new Error(`Unknown storage provider type: ${(config as { type: string }).type}`)
  }
}
