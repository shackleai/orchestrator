/**
 * Issue attachment CRUD routes — /api/companies/:id/issues/:issueId/attachments
 *
 * Upload, list, download, and delete file attachments on issues.
 * Uses the pluggable StorageProvider from @shackleai/core.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { StorageProvider } from '@shackleai/core'
import type { Issue, IssueAttachment } from '@shackleai/shared'
import { MAX_ATTACHMENT_SIZE_BYTES } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

/**
 * Verify the issue exists and belongs to the company.
 * Returns null if not found, otherwise the issue id.
 */
async function verifyIssueOwnership(
  db: DatabaseProvider,
  issueId: string,
  companyId: string,
): Promise<string | null> {
  const result = await db.query<Pick<Issue, 'id'>>(
    `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
    [issueId, companyId],
  )
  return result.rows.length > 0 ? result.rows[0].id : null
}

export function attachmentsRouter(
  db: DatabaseProvider,
  storage: StorageProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/issues/:issueId/attachments — list attachments
  app.get('/:id/issues/:issueId/attachments', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const { limit, offset } = parsePagination(c)
    const result = await db.query<IssueAttachment>(
      `SELECT * FROM issue_attachments WHERE issue_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [issueId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues/:issueId/attachments — upload file
  app.post('/:id/issues/:issueId/attachments', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const body = await c.req.parseBody()
    const file = body['file']
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Missing file in multipart form data' }, 400)
    }

    const agentId =
      typeof body['agent_id'] === 'string' && body['agent_id'].trim()
        ? body['agent_id'].trim()
        : null

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = file.name || 'unnamed'
    const mime = file.type || 'application/octet-stream'

    if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
      return c.json(
        {
          error: `File too large. Maximum size is ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)} MB`,
        },
        413,
      )
    }

    // Build storage key: attachments/<companyId>/<issueId>/<uuid>-<filename>
    const uniquePrefix = crypto.randomUUID()
    const storageKey = `attachments/${companyId}/${issueId}/${uniquePrefix}-${filename}`

    const uploadResult = await storage.upload(storageKey, buffer, mime)

    const result = await db.query<IssueAttachment>(
      `INSERT INTO issue_attachments (issue_id, filename, mime_type, size_bytes, storage_key, uploaded_by_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [issueId, filename, mime, uploadResult.size, storageKey, agentId],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/issues/:issueId/attachments/:attachId — download
  app.get(
    '/:id/issues/:issueId/attachments/:attachId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id')!
      const issueId = c.req.param('issueId')!
      const attachId = c.req.param('attachId')!

      const found = await verifyIssueOwnership(db, issueId, companyId)
      if (!found) {
        return c.json({ error: 'Issue not found' }, 404)
      }

      const result = await db.query<IssueAttachment>(
        `SELECT * FROM issue_attachments WHERE id = $1 AND issue_id = $2`,
        [attachId, issueId],
      )

      if (result.rows.length === 0) {
        return c.json({ error: 'Attachment not found' }, 404)
      }

      const attachment = result.rows[0]
      const download = await storage.download(attachment.storage_key)

      return new Response(download.buffer, {
        headers: {
          'Content-Type': download.mime,
          'Content-Length': String(download.size),
          'Content-Disposition': `attachment; filename="${attachment.filename}"`,
        },
      })
    },
  )

  // DELETE /api/companies/:id/issues/:issueId/attachments/:attachId — delete
  app.delete(
    '/:id/issues/:issueId/attachments/:attachId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id')!
      const issueId = c.req.param('issueId')!
      const attachId = c.req.param('attachId')!

      const found = await verifyIssueOwnership(db, issueId, companyId)
      if (!found) {
        return c.json({ error: 'Issue not found' }, 404)
      }

      const result = await db.query<IssueAttachment>(
        `DELETE FROM issue_attachments WHERE id = $1 AND issue_id = $2 RETURNING *`,
        [attachId, issueId],
      )

      if (result.rows.length === 0) {
        return c.json({ error: 'Attachment not found' }, 404)
      }

      // Delete from storage (non-blocking — DB is source of truth)
      void storage.delete(result.rows[0].storage_key).catch(() => {
        // Orphan file cleanup can be handled by a background job
      })

      return c.json({ data: result.rows[0] })
    },
  )

  return app
}
