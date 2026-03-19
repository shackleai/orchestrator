/**
 * Company logo routes — /api/companies/:id/logo
 *
 * Upload and remove a company logo. Reuses the asset upload pipeline
 * (storage + assets table) and links the resulting asset to the company
 * via companies.logo_asset_id.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { StorageProvider } from '@shackleai/core'
import type { Asset, Company } from '@shackleai/shared'
import { MAX_ASSET_SIZE_BYTES } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

/** Image MIME types allowed for logos. */
const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const

type Variables = CompanyScopeVariables

export function companyLogoRouter(
  db: DatabaseProvider,
  storage: StorageProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // PUT /api/companies/:id/logo — upload or replace company logo
  app.put('/:id/logo', companyScope, async (c) => {
    const companyId = c.req.param('id')!

    const body = await c.req.parseBody()
    const file = body['file']
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Missing file in multipart form data' }, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = file.name || 'logo'
    const mime = file.type || 'application/octet-stream'

    // Validate file size
    if (buffer.length > MAX_ASSET_SIZE_BYTES) {
      return c.json(
        { error: `File too large. Maximum size is ${MAX_ASSET_SIZE_BYTES / (1024 * 1024)} MB` },
        413,
      )
    }

    // Validate MIME type — logos must be images
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(mime)) {
      return c.json(
        { error: `Unsupported file type: ${mime}. Logos must be images: ${LOGO_MIME_TYPES.join(', ')}` },
        415,
      )
    }

    // Upload to storage
    const uniquePrefix = crypto.randomUUID()
    const storageKey = `assets/${companyId}/${uniquePrefix}-${filename}`
    const uploadResult = await storage.upload(storageKey, buffer, mime)

    // Create asset record
    const assetResult = await db.query<Asset>(
      `INSERT INTO assets (company_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [companyId, filename, mime, uploadResult.size, storageKey, null],
    )
    const asset = assetResult.rows[0]

    // Get the old logo asset id so we can clean it up
    const company = c.get('company')
    const oldLogoAssetId = company.logo_asset_id

    // Link new logo to company
    const companyResult = await db.query<Company>(
      `UPDATE companies SET logo_asset_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [asset.id, companyId],
    )

    // Clean up old logo asset if one existed
    if (oldLogoAssetId) {
      const oldAssetResult = await db.query<Asset>(
        `DELETE FROM assets WHERE id = $1 AND company_id = $2 RETURNING *`,
        [oldLogoAssetId, companyId],
      )
      if (oldAssetResult.rows.length > 0) {
        void storage.delete(oldAssetResult.rows[0].storage_key).catch(() => {
          // Orphan file cleanup can be handled by a background job
        })
      }
    }

    const updatedCompany = companyResult.rows[0]
    return c.json({
      data: {
        ...updatedCompany,
        logo_url: `/api/assets/${asset.id}`,
      },
    })
  })

  // DELETE /api/companies/:id/logo — remove company logo
  app.delete('/:id/logo', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const company = c.get('company')

    if (!company.logo_asset_id) {
      return c.json({ error: 'Company has no logo' }, 404)
    }

    // Unlink logo from company
    const companyResult = await db.query<Company>(
      `UPDATE companies SET logo_asset_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [companyId],
    )

    // Delete the asset record and storage file
    const assetResult = await db.query<Asset>(
      `DELETE FROM assets WHERE id = $1 AND company_id = $2 RETURNING *`,
      [company.logo_asset_id, companyId],
    )
    if (assetResult.rows.length > 0) {
      void storage.delete(assetResult.rows[0].storage_key).catch(() => {
        // Orphan file cleanup can be handled by a background job
      })
    }

    return c.json({ data: companyResult.rows[0] })
  })

  return app
}
