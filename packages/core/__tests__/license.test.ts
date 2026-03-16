import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest'
import { PGliteProvider, runMigrations } from '@shackleai/db'
import type { DatabaseProvider } from '@shackleai/db'
import { LicenseManager } from '../src/license.js'
import { LicenseTier } from '@shackleai/shared'

let db: PGliteProvider
const COMPANY_ID = '00000000-0000-4000-a000-000000000099'

async function seedTestData(provider: DatabaseProvider): Promise<void> {
  await provider.query(
    `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [COMPANY_ID, 'License Test Co', 'active', 'LIC', 0, 0, 0],
  )
}

beforeAll(async () => {
  db = new PGliteProvider() // in-memory
  await runMigrations(db)
  await seedTestData(db)
})

afterAll(async () => {
  await db.close()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LicenseManager', () => {
  describe('key format validation', () => {
    it('rejects keys with invalid format', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      await expect(mgr.activate('invalid-key')).rejects.toThrow(
        'Invalid license key format',
      )
      await expect(mgr.activate('sk_shackle_bad_abc')).rejects.toThrow(
        'Invalid license key format',
      )
      await expect(mgr.activate('sk_shackle_live_short')).rejects.toThrow(
        'Invalid license key format',
      )
      await expect(mgr.activate('')).rejects.toThrow(
        'Invalid license key format',
      )
    })

    it('accepts valid live keys', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Mock fetch to return a successful response
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ tier: 'pro', valid_until: null }),
        }),
      )

      const result = await mgr.activate('sk_shackle_live_abcdefghijkl')
      expect(result.tier).toBe('pro')
      expect(result.features).toContain('api_access')
    })

    it('accepts valid test keys', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ tier: 'teams', valid_until: null }),
        }),
      )

      const result = await mgr.activate('sk_shackle_test_123456789012')
      expect(result.tier).toBe('teams')
      expect(result.features).toContain('team_collaboration')
    })
  })

  describe('activation with mocked API', () => {
    it('activates and stores license from API response', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            tier: 'enterprise',
            valid_until: '2027-01-01T00:00:00Z',
          }),
        }),
      )

      const result = await mgr.activate('sk_shackle_live_enterprisekey1')
      expect(result.tier).toBe('enterprise')
      expect(result.features).toContain('custom_adapters')
      expect(result.features).toContain('sla')
      expect(result.features).toContain('dedicated_support')

      // Verify stored in DB (hash, not plaintext)
      const rows = await db.query<{ key_hash: string; tier: string }>(
        'SELECT key_hash, tier FROM license_keys WHERE company_id = $1',
        [COMPANY_ID],
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0].tier).toBe('enterprise')
      // Key hash should be a 64-char hex string (SHA-256)
      expect(rows.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/)
      // Must NOT be the plaintext key
      expect(rows.rows[0].key_hash).not.toBe('sk_shackle_live_enterprisekey1')
    })

    it('activates with fallback when API is unreachable', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error')),
      )

      const result = await mgr.activate('sk_shackle_live_offlinekey123')
      // Falls back to Free tier when offline (security fix — no Pro without validation)
      expect(result.tier).toBe('free')
    })

    it('throws when API returns non-ok status', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // When API returns 403, activate should still succeed (offline fallback)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
        }),
      )

      const result = await mgr.activate('sk_shackle_live_rejectedkey12')
      // Falls back to free tier (security fix — no Pro without validation)
      expect(result.tier).toBe('free')
    })
  })

  describe('check()', () => {
    it('returns free tier when no license exists', async () => {
      // Use a different company with no license
      const otherCompanyId = '00000000-0000-4000-a000-000000000098'
      await db.query(
        `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [otherCompanyId, 'No License Co', 'active', 'NLC', 0, 0, 0],
      )

      const mgr = new LicenseManager(db, otherCompanyId)
      const status = await mgr.check()

      expect(status.tier).toBe('free')
      expect(status.features).toContain('basic_orchestration')
      expect(status.features).not.toContain('api_access')
      expect(status.warning).toBeUndefined()
    })

    it('returns current tier for valid license', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Clean and insert a valid license
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const futureDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'abc123hash', 'pro', futureDate],
      )

      const status = await mgr.check()
      expect(status.tier).toBe('pro')
      expect(status.features).toContain('api_access')
      expect(status.warning).toBeUndefined()
    })
  })

  describe('offline grace period (7 days)', () => {
    it('returns current tier with warning during grace period', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Insert a license that expired 3 days ago (within 7-day grace)
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const expiredDate = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'gracehash123', 'teams', expiredDate],
      )

      const status = await mgr.check()
      expect(status.tier).toBe('teams')
      expect(status.warning).toContain('Grace period active')
    })

    it('downgrades to free after grace period expires', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Insert a license that expired 10 days ago (beyond 7-day grace)
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const expiredDate = new Date(
        Date.now() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'expiredhash12', 'enterprise', expiredDate],
      )

      const status = await mgr.check()
      expect(status.tier).toBe('free')
      expect(status.warning).toContain('grace period ended')
    })
  })

  describe('isFeatureEnabled()', () => {
    it('returns true for features in current tier', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Set up a pro license
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const futureDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'featurehash12', 'pro', futureDate],
      )

      expect(await mgr.isFeatureEnabled('api_access')).toBe(true)
      expect(await mgr.isFeatureEnabled('unlimited_agents')).toBe(true)
      expect(await mgr.isFeatureEnabled('basic_orchestration')).toBe(true)
    })

    it('returns false for features not in current tier', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Pro tier should NOT have enterprise features
      expect(await mgr.isFeatureEnabled('custom_adapters')).toBe(false)
      expect(await mgr.isFeatureEnabled('sla')).toBe(false)
      expect(await mgr.isFeatureEnabled('team_collaboration')).toBe(false)
    })

    it('checks features correctly per tier', async () => {
      // Free tier features
      expect(
        LicenseManager.getFeaturesForTier('free'),
      ).toEqual(['basic_orchestration', 'local_only', 'max_3_agents'])

      // Pro tier features
      expect(LicenseManager.getFeaturesForTier('pro')).toContain('api_access')
      expect(LicenseManager.getFeaturesForTier('pro')).toContain(
        'unlimited_agents',
      )

      // Teams tier features
      expect(LicenseManager.getFeaturesForTier('teams')).toContain(
        'team_collaboration',
      )
      expect(LicenseManager.getFeaturesForTier('teams')).toContain(
        'shared_agents',
      )

      // Enterprise tier features
      expect(LicenseManager.getFeaturesForTier('enterprise')).toContain(
        'custom_adapters',
      )
      expect(LicenseManager.getFeaturesForTier('enterprise')).toContain('sla')
    })
  })

  describe('deactivate()', () => {
    it('removes license and reverts to free tier', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Ensure there's a license first
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const futureDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'deacthash1234', 'pro', futureDate],
      )

      // Verify license exists
      let status = await mgr.check()
      expect(status.tier).toBe('pro')

      // Deactivate
      await mgr.deactivate()

      // Should be free tier now
      status = await mgr.check()
      expect(status.tier).toBe('free')

      // DB should have no license
      const rows = await db.query(
        'SELECT * FROM license_keys WHERE company_id = $1',
        [COMPANY_ID],
      )
      expect(rows.rows).toHaveLength(0)
    })
  })

  describe('free tier — fully offline', () => {
    it('never makes API calls when no license key exists', async () => {
      const noLicenseCompany = '00000000-0000-4000-a000-000000000097'
      await db.query(
        `INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [noLicenseCompany, 'Offline Co', 'active', 'OFF', 0, 0, 0],
      )

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)
      const mgr = new LicenseManager(db, noLicenseCompany)

      // check() should not call fetch
      const status = await mgr.check()
      expect(status.tier).toBe('free')
      expect(mockFetch).not.toHaveBeenCalled()

      // isFeatureEnabled() should not call fetch
      const enabled = await mgr.isFeatureEnabled('basic_orchestration')
      expect(enabled).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()

      // periodicValidation() should not call fetch when no license exists
      const periodic = await mgr.periodicValidation()
      expect(periodic.tier).toBe('free')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('periodicValidation()', () => {
    it('does not re-validate if last validation was within 24h', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Set up license validated just now
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const futureDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [COMPANY_ID, 'periodichash1', 'pro', futureDate],
      )

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const status = await mgr.periodicValidation()
      expect(status.tier).toBe('pro')
      // Should NOT have called the API since last validation was just now
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('re-validates when last validation was over 24h ago', async () => {
      const mgr = new LicenseManager(db, COMPANY_ID)

      // Set up license validated 25 hours ago
      await db.query('DELETE FROM license_keys WHERE company_id = $1', [
        COMPANY_ID,
      ])
      const futureDate = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString()
      const oldDate = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString()
      await db.query(
        `INSERT INTO license_keys (company_id, key_hash, tier, valid_until, last_validated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [COMPANY_ID, 'stale_hash_123', 'pro', futureDate, oldDate],
      )

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            tier: 'enterprise',
            valid_until: futureDate,
          }),
        }),
      )

      const status = await mgr.periodicValidation()
      // API returned enterprise tier, which should now be stored
      expect(status.tier).toBe('enterprise')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})
