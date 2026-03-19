/**
 * S3-compatible storage provider.
 *
 * Uses native fetch against the S3 REST API to avoid heavy AWS SDK dependency.
 * Implements AWS Signature V4 for request signing.
 *
 * Supports S3-compatible services (MinIO, Cloudflare R2) via custom endpoint.
 */

import { createHmac, createHash } from 'node:crypto'
import type { StorageProvider, UploadResult, DownloadResult, S3Config } from './provider.js'

export class S3Provider implements StorageProvider {
  readonly type = 's3' as const
  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly endpoint: string

  constructor(config: Omit<S3Config, 'type'>) {
    this.bucket = config.bucket
    this.region = config.region
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.endpoint = config.endpoint ?? `https://${config.bucket}.s3.${config.region}.amazonaws.com`
  }

  async upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult> {
    const url = this.objectUrl(key)
    const headers = this.sign('PUT', key, {
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
    }, buffer)

    const res = await fetch(url, { method: 'PUT', headers, body: buffer })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`S3 PUT failed (${res.status}): ${body}`)
    }

    return { key, size: buffer.length, mime }
  }

  async download(key: string): Promise<DownloadResult> {
    const url = this.objectUrl(key)
    const headers = this.sign('GET', key, {})

    const res = await fetch(url, { method: 'GET', headers })
    if (!res.ok) {
      if (res.status === 404) throw new Error(`S3 object not found: ${key}`)
      const body = await res.text()
      throw new Error(`S3 GET failed (${res.status}): ${body}`)
    }

    const arrayBuf = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const mime = res.headers.get('content-type') ?? 'application/octet-stream'

    return { buffer, mime, size: buffer.length }
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key)
    const headers = this.sign('DELETE', key, {})

    const res = await fetch(url, { method: 'DELETE', headers })
    // S3 returns 204 on successful delete, 404 is acceptable (no-op)
    if (!res.ok && res.status !== 404) {
      const body = await res.text()
      throw new Error(`S3 DELETE failed (${res.status}): ${body}`)
    }
  }

  async getUrl(key: string): Promise<string> {
    // Return a presigned URL valid for 1 hour
    return this.presign(key, 3600)
  }

  async exists(key: string): Promise<boolean> {
    const url = this.objectUrl(key)
    const headers = this.sign('HEAD', key, {})

    const res = await fetch(url, { method: 'HEAD', headers })
    if (res.status === 404) return false
    if (res.ok) return true
    const body = await res.text()
    throw new Error(`S3 HEAD failed (${res.status}): ${body}`)
  }

  // ---------------------------------------------------------------------------
  // AWS Signature V4
  // ---------------------------------------------------------------------------

  private objectUrl(key: string): string {
    const normalized = key.replace(/^\/+/, '')
    if (this.endpoint.includes(this.bucket)) {
      return `${this.endpoint}/${normalized}`
    }
    return `${this.endpoint}/${this.bucket}/${normalized}`
  }

  /**
   * Sign a request using AWS Signature V4.
   * Minimal implementation covering the S3 REST operations we need.
   */
  private sign(
    method: string,
    key: string,
    extraHeaders: Record<string, string>,
    body?: Buffer,
  ): Record<string, string> {
    const now = new Date()
    const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8)
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

    const host = new URL(this.objectUrl(key)).host
    const canonicalUri = '/' + key.replace(/^\/+/, '')

    const payloadHash = sha256(body ?? Buffer.alloc(0))

    const headers: Record<string, string> = {
      ...extraHeaders,
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    }

    const signedHeaderKeys = Object.keys(headers).sort()
    const signedHeaders = signedHeaderKeys.join(';')
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join('')

    const canonicalRequest = [
      method,
      canonicalUri,
      '', // query string (empty for these operations)
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(Buffer.from(canonicalRequest)),
    ].join('\n')

    const signingKey = this.deriveSigningKey(dateStamp)
    const signature = hmacHex(signingKey, stringToSign)

    headers['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`

    // Remove host — fetch sets it automatically
    delete headers['host']
    return headers
  }

  /**
   * Generate a presigned URL for GET requests.
   */
  private presign(key: string, expiresIn: number): string {
    const now = new Date()
    const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8)
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

    const host = new URL(this.objectUrl(key)).host
    const canonicalUri = '/' + key.replace(/^\/+/, '')
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`

    const queryParams = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    })

    // Sort query params for canonical request
    queryParams.sort()
    const canonicalQueryString = queryParams.toString()

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQueryString,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(Buffer.from(canonicalRequest)),
    ].join('\n')

    const signingKey = this.deriveSigningKey(dateStamp)
    const signature = hmacHex(signingKey, stringToSign)

    return `${this.objectUrl(key)}?${canonicalQueryString}&X-Amz-Signature=${signature}`
  }

  private deriveSigningKey(dateStamp: string): Buffer {
    const kDate = hmac(Buffer.from(`AWS4${this.secretAccessKey}`), dateStamp)
    const kRegion = hmac(kDate, this.region)
    const kService = hmac(kRegion, 's3')
    return hmac(kService, 'aws4_request')
  }
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex')
}
