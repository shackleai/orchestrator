/**
 * LicenseManager — license key validation for the free-to-paid upgrade path.
 *
 * Security principles:
 * - NEVER store plaintext license keys — only SHA-256 hashes.
 * - NEVER phone home without an explicit license key — free tier is fully offline.
 * - All queries are parameterized and scoped to company_id.
 * - 7-day offline grace period for expired validations.
 * - Periodic re-validation every 24 hours.
 */

import { createHash } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import { LicenseTier } from '@shackleai/shared'
import type { LicenseKey } from '@shackleai/shared'

/** Regex for valid license key format. */
const KEY_FORMAT = /^sk_shackle_(live|test)_[a-zA-Z0-9]{12,}$/

/** Features available per tier. */
const TIER_FEATURES: Record<string, string[]> = {
  [LicenseTier.Free]: [
    'basic_orchestration',
    'local_only',
    'max_3_agents',
  ],
  [LicenseTier.Pro]: [
    'basic_orchestration',
    'local_only',
    'unlimited_agents',
    'api_access',
    'priority_adapters',
  ],
  [LicenseTier.Teams]: [
    'basic_orchestration',
    'local_only',
    'unlimited_agents',
    'api_access',
    'priority_adapters',
    'team_collaboration',
    'shared_agents',
  ],
  [LicenseTier.Enterprise]: [
    'basic_orchestration',
    'local_only',
    'unlimited_agents',
    'api_access',
    'priority_adapters',
    'team_collaboration',
    'shared_agents',
    'custom_adapters',
    'sla',
    'dedicated_support',
  ],
}

/** Grace period: 7 days in milliseconds. */
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

/** Re-validation interval: 24 hours in milliseconds. */
const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000

/** API base URL for license validation. */
const API_BASE = 'https://api.shackleai.com/v1'

export interface LicenseStatus {
  tier: string
  features: string[]
  warning?: string
}

export interface ActivationResult {
  tier: string
  features: string[]
}

export class LicenseManager {
  private db: DatabaseProvider
  private companyId: string

  constructor(db: DatabaseProvider, companyId: string) {
    this.db = db
    this.companyId = companyId
  }

  /**
   * Hash a license key with SHA-256. NEVER store the plaintext key.
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex')
  }

  /**
   * Validate the key format matches `sk_shackle_(live|test)_<12+ alphanumeric>`.
   */
  private validateKeyFormat(key: string): boolean {
    return KEY_FORMAT.test(key)
  }

  /**
   * Activate a license key: validate format, call API, store hash + tier in DB.
   *
   * - Validates key format locally first.
   * - Calls api.shackleai.com to validate the key (allows offline fallback).
   * - Stores the SHA-256 hash (NEVER the plaintext key) in license_keys.
   * - Returns the tier and unlocked features.
   */
  async activate(key: string): Promise<ActivationResult> {
    if (!this.validateKeyFormat(key)) {
      throw new Error(
        'Invalid license key format. Expected: sk_shackle_(live|test)_<key>',
      )
    }

    const keyHash = this.hashKey(key)

    // Attempt API validation — gracefully handle offline
    let tier: string = LicenseTier.Pro // default if API unreachable
    let validUntil: string | null = null

    try {
      const response = await fetch(`${API_BASE}/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        throw new Error(`License validation failed: ${response.status}`)
      }

      const data = (await response.json()) as {
        tier: string
        valid_until: string | null
      }
      tier = data.tier
      validUntil = data.valid_until
    } catch {
      // Offline or API error — accept the key with Pro tier as fallback.
      // The key format was valid, so we trust it for now.
      // periodicValidation() will re-check when connectivity returns.
    }

    // Remove any existing license for this company before inserting
    await this.db.query(
      `DELETE FROM license_keys WHERE company_id = $1`,
      [this.companyId],
    )

    // Store the hash, NEVER the plaintext key
    await this.db.query(
      `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [this.companyId, keyHash, tier, validUntil],
    )

    const features = TIER_FEATURES[tier] ?? TIER_FEATURES[LicenseTier.Free]

    return { tier, features }
  }

  /**
   * Check the current license status for this company.
   *
   * - No license key -> free tier (fully offline, no API calls).
   * - Expired but within 7-day grace -> current tier with warning.
   * - Expired beyond grace -> free tier.
   */
  async check(): Promise<LicenseStatus> {
    const result = await this.db.query<LicenseKey>(
      `SELECT tier, valid_until, last_validated_at
       FROM license_keys
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.companyId],
    )

    // No license key — free tier, fully offline
    if (result.rows.length === 0) {
      return {
        tier: LicenseTier.Free,
        features: TIER_FEATURES[LicenseTier.Free],
      }
    }

    const license = result.rows[0]
    const now = Date.now()

    // Check expiration
    if (license.valid_until) {
      const expiresAt = new Date(license.valid_until).getTime()

      if (now > expiresAt) {
        // Expired — check grace period
        const graceDeadline = expiresAt + GRACE_PERIOD_MS

        if (now <= graceDeadline) {
          // Within grace period — return current tier with warning
          const features =
            TIER_FEATURES[license.tier] ?? TIER_FEATURES[LicenseTier.Free]
          return {
            tier: license.tier,
            features,
            warning:
              'License expired. Grace period active — please renew to avoid downgrade.',
          }
        }

        // Beyond grace — downgrade to free
        return {
          tier: LicenseTier.Free,
          features: TIER_FEATURES[LicenseTier.Free],
          warning: 'License expired and grace period ended. Downgraded to free tier.',
        }
      }
    }

    // Valid license
    const features =
      TIER_FEATURES[license.tier] ?? TIER_FEATURES[LicenseTier.Free]
    return { tier: license.tier, features }
  }

  /**
   * Check if a specific feature is enabled for the current license tier.
   */
  async isFeatureEnabled(feature: string): Promise<boolean> {
    const status = await this.check()
    return status.features.includes(feature)
  }

  /**
   * Deactivate (remove) the license key for this company.
   * Reverts to free tier immediately.
   */
  async deactivate(): Promise<void> {
    await this.db.query(
      `DELETE FROM license_keys WHERE company_id = $1`,
      [this.companyId],
    )
  }

  /**
   * Periodic validation: re-validate the license key against the API
   * if more than 24 hours have passed since the last validation.
   *
   * This is called on-demand (not via a timer) — the caller decides when to invoke it.
   * NEVER phones home without an existing license key.
   */
  async periodicValidation(): Promise<LicenseStatus> {
    const result = await this.db.query<LicenseKey>(
      `SELECT id, key_hash, tier, valid_until, last_validated_at
       FROM license_keys
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.companyId],
    )

    // No license key — nothing to validate, return free tier
    if (result.rows.length === 0) {
      return {
        tier: LicenseTier.Free,
        features: TIER_FEATURES[LicenseTier.Free],
      }
    }

    const license = result.rows[0]
    const now = Date.now()
    const lastValidated = license.last_validated_at
      ? new Date(license.last_validated_at).getTime()
      : 0

    // Only re-validate if 24h+ since last validation
    if (now - lastValidated < REVALIDATION_INTERVAL_MS) {
      return this.check()
    }

    // Attempt re-validation via API
    try {
      const response = await fetch(`${API_BASE}/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_hash: license.key_hash }),
        signal: AbortSignal.timeout(10_000),
      })

      if (response.ok) {
        const data = (await response.json()) as {
          tier: string
          valid_until: string | null
        }

        // Update stored license with fresh data
        await this.db.query(
          `UPDATE license_keys
           SET tier = $1, valid_until = $2, last_validated_at = NOW()
           WHERE id = $3 AND company_id = $4`,
          [data.tier, data.valid_until, license.id, this.companyId],
        )
      } else {
        // API rejected — just update timestamp so we don't hammer the API
        await this.db.query(
          `UPDATE license_keys SET last_validated_at = NOW()
           WHERE id = $1 AND company_id = $2`,
          [license.id, this.companyId],
        )
      }
    } catch {
      // Offline — update timestamp to avoid retry storm
      await this.db.query(
        `UPDATE license_keys SET last_validated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [license.id, this.companyId],
      )
    }

    return this.check()
  }

  /**
   * Get the feature list for a given tier (static utility).
   */
  static getFeaturesForTier(tier: string): string[] {
    return TIER_FEATURES[tier] ?? TIER_FEATURES[LicenseTier.Free]
  }
}
