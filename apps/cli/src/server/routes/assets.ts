/**
 * Asset management routes — /api/companies/:id/assets and /api/assets/:assetId
 *
 * Upload, list, serve, and delete company-level file assets.
 * Uses the pluggable StorageProvider from @shackleai/core.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { StorageProvider } from '@shackleai/core'
import type { Asset } from '@shackleai/shared'
import { MAX_ASSET_SIZE_BYTES, ALLOWED_ASSET_MIME_TYPES } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

/**
 * Company-scoped asset routes: upload, list, delete.
 * Mounted at /api/companies so paths include /:id/assets.
 */
export function assetsRouter(
  db: DatabaseProvider,
  storage: StorageProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/assets — list assets for the company
  app.get('/:id/assets', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const { limit, offset } = parsePagination(c)

    const result = await db.query<Asset>(
      `SELECT * FROM assets WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/assets — upload a file
  app.post('/:id/assets', companyScope, async (c) => {
    const companyId = c.req.param('id')!

    const body = await c.req.parseBody()
    const file = body['file']
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Missing file in multipart form data' }, 400)
    }

    const uploadedBy =
      typeof body['uploaded_by'] === 'string' && body['uploaded_by'].trim()
        ? body['uploaded_by'].trim()
        : null

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = file.name || 'unnamed'
    const mime = file.type || 'application/octet-stream'

    // Validate file size
    if (buffer.length > MAX_ASSET_SIZE_BYTES) {
      return c.json(
        {
          error: `File too large. Maximum size is ${MAX_ASSET_SIZE_BYTES / (1024 * 1024)} MB`,
        },
        413,
      )
    }

    // Validate MIME type
    if (
      !(ALLOWED_ASSET_MIME_TYPES as readonly string[]).includes(mime)
    ) {
      return c.json(
        {
          error: `Unsupported file type: ${mime}. Allowed types: ${ALLOWED_ASSET_MIME_TYPES.join(', ')}`,
        },
        415,
      )
    }

    // Build storage key: assets/<companyId>/<uuid>-<filename>
    const uniquePrefix = crypto.randomUUID()
    const storageKey = `assets/${companyId}/${uniquePrefix}-${filename}`

    const uploadResult = await storage.upload(storageKey, buffer, mime)

    const result = await db.query<Asset>(
      `INSERT INTO assets (company_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [companyId, filename, mime, uploadResult.size, storageKey, uploadedBy],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // DELETE /api/companies/:id/assets/:assetId — delete an asset
  app.delete('/:id/assets/:assetId', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const assetId = c.req.param('assetId')!

    const result = await db.query<Asset>(
      `DELETE FROM assets WHERE id = $1 AND company_id = $2 RETURNING *`,
      [assetId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Asset not found' }, 404)
    }

    // Delete from storage (non-blocking — DB is source of truth)
    void storage.delete(result.rows[0].storage_key).catch(() => {
      // Orphan file cleanup can be handled by a background job
    })

    return c.json({ data: result.rows[0] })
  })

  return app
}

/**
 * Public asset serving route — /api/assets/:assetId
 * No company scope required; asset ID is globally unique.
 */
export function assetServeRouter(
  db: DatabaseProvider,
  storage: StorageProvider,
): Hono {
  const app = new Hono()

  // GET /api/assets/:assetId — serve file content
  app.get('/:assetId', async (c) => {
    const assetId = c.req.param('assetId')!

    const result = await db.query<Asset>(
      `SELECT * FROM assets WHERE id = $1`,
      [assetId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Asset not found' }, 404)
    }

    const asset = result.rows[0]
    const download = await storage.download(asset.storage_key)

    return new Response(download.buffer, {
      headers: {
        'Content-Type': download.mime,
        'Content-Length': String(download.size),
        'Content-Disposition': `inline; filename="${asset.filename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  })

  return app
}
