/**
 * SecretsManager — AES-256-GCM encrypted secret storage.
 *
 * Derives an encryption key from a master secret (env var SHACKLEAI_SECRET_KEY
 * or auto-generated file at ~/.shackleai/orchestrator/.secret-key).
 *
 * Encrypted format: iv:authTag:ciphertext (all hex-encoded).
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseProvider } from '@shackleai/db'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const SALT = 'shackleai-secrets-v1'

/** Path to auto-generated secret key file. */
function secretKeyPath(): string {
  return join(homedir(), '.shackleai', 'orchestrator', '.secret-key')
}

/** Load or generate the master secret key. */
function loadMasterSecret(): string {
  const envKey = process.env.SHACKLEAI_SECRET_KEY
  if (envKey && envKey.length > 0) {
    return envKey
  }

  const keyPath = secretKeyPath()
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, 'utf-8').trim()
  }

  const generated = randomBytes(32).toString('hex')
  const dir = join(homedir(), '.shackleai', 'orchestrator')
  mkdirSync(dir, { recursive: true })
  writeFileSync(keyPath, generated, { mode: 0o600 })
  return generated
}

/** Derive a 256-bit key from the master secret using scrypt. */
function deriveKey(masterSecret: string): Buffer {
  return scryptSync(masterSecret, SALT, KEY_LENGTH)
}

export interface SecretRow {
  id: string
  company_id: string
  name: string
  encrypted_value: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SecretListItem {
  id: string
  name: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export class SecretsManager {
  private db: DatabaseProvider
  private key: Buffer

  constructor(db: DatabaseProvider, masterSecret?: string) {
    this.db = db
    const secret = masterSecret ?? loadMasterSecret()
    this.key = deriveKey(secret)
  }

  /** Encrypt a plaintext value. Returns iv:authTag:ciphertext (hex). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH })
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex')
  }

  /** Decrypt a value in iv:authTag:ciphertext format. */
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format')
    }

    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = Buffer.from(parts[2], 'hex')

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  }

  /** Store an encrypted secret. Returns null if a secret with the same name already exists (#306). */
  async store(
    companyId: string,
    name: string,
    value: string,
    createdBy?: string,
  ): Promise<SecretRow | null> {
    const encryptedValue = this.encrypt(value)

    const sql = [
      'INSERT INTO secrets (company_id, name, encrypted_value, created_by)',
      'VALUES ($1, $2, $3, $4)',
      'ON CONFLICT (company_id, name) DO NOTHING',
      'RETURNING *',
    ].join(' ')

    const result = await this.db.query<SecretRow>(sql, [
      companyId,
      name,
      encryptedValue,
      createdBy ?? null,
    ])

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0]
  }

  /** Get a decrypted secret by name. Returns null if not found. */
  async get(companyId: string, name: string): Promise<string | null> {
    const result = await this.db.query<SecretRow>(
      'SELECT * FROM secrets WHERE company_id = $1 AND name = $2',
      [companyId, name],
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.decrypt(result.rows[0].encrypted_value)
  }

  /** List secrets for a company (names only). */
  async list(companyId: string): Promise<SecretListItem[]> {
    const sql = [
      'SELECT id, name, created_by, created_at, updated_at',
      'FROM secrets WHERE company_id = $1 ORDER BY name',
    ].join(' ')

    const result = await this.db.query<SecretListItem>(sql, [companyId])

    return result.rows
  }

  /** Delete a secret by name. Returns true if deleted, false if not found. */
  async delete(companyId: string, name: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      'DELETE FROM secrets WHERE company_id = $1 AND name = $2 RETURNING id',
      [companyId, name],
    )

    return result.rows.length > 0
  }

  /** Get all secret names and their decrypted values for a company (env injection). */
  async getAllDecrypted(companyId: string): Promise<Record<string, string>> {
    const result = await this.db.query<SecretRow>(
      'SELECT name, encrypted_value FROM secrets WHERE company_id = $1',
      [companyId],
    )

    const secrets: Record<string, string> = {}
    for (const row of result.rows) {
      try {
        secrets[row.name] = this.decrypt(row.encrypted_value)
      } catch {
        // Skip secrets that fail to decrypt (e.g., key rotation)
      }
    }

    return secrets
  }
}
