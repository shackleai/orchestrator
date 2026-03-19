/**
 * Document CRUD, revisions, and issue-document linking routes
 * /api/companies/:id/documents and /api/companies/:id/issues/:issueId/documents
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Document, DocumentRevision } from '@shackleai/shared'
import {
  CreateDocumentInput,
  UpdateDocumentInput,
  LinkDocumentInput,
} from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function documentsRouter(
  db: DatabaseProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/documents
  app.get('/:id/documents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const result = await db.query<Document>(
      'SELECT * FROM documents WHERE company_id = $1 ORDER BY updated_at DESC',
      [companyId],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/documents
  app.post('/:id/documents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = CreateDocumentInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }
    const { title, content, created_by_agent_id } = parsed.data
    if (created_by_agent_id) {
      const agentCheck = await db.query<{ id: string }>(
        'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
        [created_by_agent_id, companyId],
      )
      if (agentCheck.rows.length === 0) {
        return c.json({ error: 'Agent not found in this company' }, 404)
      }
    }
    const result = await db.query<Document>(
      `INSERT INTO documents (company_id, title, content, created_by_agent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [companyId, title, content, created_by_agent_id ?? null],
    )
    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/documents/:docId
  app.get('/:id/documents/:docId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const docId = c.req.param('docId')
    const result = await db.query<Document>(
      'SELECT * FROM documents WHERE id = $1 AND company_id = $2',
      [docId, companyId],
    )
    if (result.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404)
    }
    return c.json({ data: result.rows[0] })
  })

  // PUT /api/companies/:id/documents/:docId -- auto-creates revision on content change
  app.put('/:id/documents/:docId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const docId = c.req.param('docId')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = UpdateDocumentInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }
    const updates = parsed.data
    const existing = await db.query<Document>(
      'SELECT * FROM documents WHERE id = $1 AND company_id = $2',
      [docId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404)
    }
    const doc = existing.rows[0]
    // Create revision of old content when content changes
    if (updates.content !== undefined && updates.content !== doc.content) {
      const revResult = await db.query<{ max_rev: number | null }>(
        'SELECT MAX(revision_number) AS max_rev FROM document_revisions WHERE document_id = $1',
        [docId],
      )
      const nextRev = (revResult.rows[0]?.max_rev ?? 0) + 1
      await db.query(
        `INSERT INTO document_revisions (document_id, content, revision_number, created_by_agent_id)
         VALUES ($1, $2, $3, $4)`,
        [docId, doc.content, nextRev, updates.updated_by_agent_id ?? null],
      )
    }
    // Build dynamic update
    const setClauses: string[] = ['updated_at = NOW()']
    const values: unknown[] = [docId, companyId]
    let paramIdx = 3
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIdx}`)
      values.push(updates.title)
      paramIdx++
    }
    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIdx}`)
      values.push(updates.content)
      paramIdx++
    }
    const result = await db.query<Document>(
      `UPDATE documents SET ${setClauses.join(', ')}
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      values,
    )
    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/documents/:docId
  app.delete('/:id/documents/:docId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const docId = c.req.param('docId')
    const result = await db.query(
      'DELETE FROM documents WHERE id = $1 AND company_id = $2 RETURNING id',
      [docId, companyId],
    )
    if (result.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404)
    }
    return c.json({ data: { deleted: true } })
  })

  // GET /api/companies/:id/documents/:docId/revisions
  app.get('/:id/documents/:docId/revisions', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const docId = c.req.param('docId')
    const docCheck = await db.query<{ id: string }>(
      'SELECT id FROM documents WHERE id = $1 AND company_id = $2',
      [docId, companyId],
    )
    if (docCheck.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404)
    }
    const result = await db.query<DocumentRevision>(
      'SELECT * FROM document_revisions WHERE document_id = $1 ORDER BY revision_number DESC',
      [docId],
    )
    return c.json({ data: result.rows })
  })

  // GET /api/companies/:id/issues/:issueId/documents
  app.get('/:id/issues/:issueId/documents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')
    const issueCheck = await db.query<{ id: string }>(
      'SELECT id FROM issues WHERE id = $1 AND company_id = $2',
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }
    const result = await db.query<Document>(
      `SELECT d.* FROM documents d
       INNER JOIN issue_documents idoc ON idoc.document_id = d.id
       WHERE idoc.issue_id = $1
       ORDER BY d.updated_at DESC`,
      [issueId],
    )
    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues/:issueId/documents -- link
  app.post('/:id/issues/:issueId/documents', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = LinkDocumentInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }
    const { document_id } = parsed.data
    const issueCheck = await db.query<{ id: string }>(
      'SELECT id FROM issues WHERE id = $1 AND company_id = $2',
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }
    const docCheck = await db.query<{ id: string }>(
      'SELECT id FROM documents WHERE id = $1 AND company_id = $2',
      [document_id, companyId],
    )
    if (docCheck.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404)
    }
    const existing = await db.query(
      'SELECT * FROM issue_documents WHERE issue_id = $1 AND document_id = $2',
      [issueId, document_id],
    )
    if (existing.rows.length > 0) {
      return c.json({ error: 'Document already linked to this issue' }, 409)
    }
    await db.query(
      'INSERT INTO issue_documents (issue_id, document_id) VALUES ($1, $2)',
      [issueId, document_id],
    )
    return c.json({ data: { linked: true } }, 201)
  })

  // DELETE /api/companies/:id/issues/:issueId/documents/:docId -- unlink
  app.delete('/:id/issues/:issueId/documents/:docId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')
    const docId = c.req.param('docId')
    const issueCheck = await db.query<{ id: string }>(
      'SELECT id FROM issues WHERE id = $1 AND company_id = $2',
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }
    const result = await db.query(
      'DELETE FROM issue_documents WHERE issue_id = $1 AND document_id = $2 RETURNING issue_id',
      [issueId, docId],
    )
    if (result.rows.length === 0) {
      return c.json({ error: 'Document not linked to this issue' }, 404)
    }
    return c.json({ data: { unlinked: true } })
  })

  return app
}
