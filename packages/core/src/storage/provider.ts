/**
 * Storage provider interface for pluggable file storage backends.
 *
 * Implementations: LocalDiskProvider, S3Provider
 */

/** Metadata returned after a successful upload */
export interface UploadResult {
  key: string
  size: number
  mime: string
}

/** Result of a download operation */
export interface DownloadResult {
  buffer: Buffer
  mime: string
  size: number
}

/** Configuration for local disk storage */
export interface LocalDiskConfig {
  type: 'local-disk'
  /** Base directory for file storage. Defaults to ~/.shackleai/orchestrator/storage/ */
  basePath?: string
}

/** Configuration for S3-compatible storage */
export interface S3Config {
  type: 's3'
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Optional endpoint for S3-compatible services (MinIO, R2, etc.) */
  endpoint?: string
}

export type StorageConfig = LocalDiskConfig | S3Config

/**
 * Abstract storage provider interface.
 *
 * All keys are forward-slash-separated paths (e.g. "uploads/org-123/logo.png").
 * Providers normalize keys internally.
 */
export interface StorageProvider {
  readonly type: string

  /** Upload a file. Returns metadata about the stored object. */
  upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult>

  /** Download a file by key. Throws if the key does not exist. */
  download(key: string): Promise<DownloadResult>

  /** Delete a file by key. No-op if the key does not exist. */
  delete(key: string): Promise<void>

  /** Get a URL for the file (local path or presigned S3 URL). */
  getUrl(key: string): Promise<string>

  /** Check whether a file exists at the given key. */
  exists(key: string): Promise<boolean>
}
