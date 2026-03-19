/**
 * Label CRUD + issue-label assignment routes — /api/companies/:id/labels
 * and /api/companies/:id/issues/:issueId/labels
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Label, IssueLabel } from '@shackleai/shared'
import { CreateLabelInput, UpdateLabelInput, AssignLabelInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function labelsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // -------------------------------------------------------------------------
  // Label CRUD — /api/companies/:id/labels
  // -------------------------------------------------------------------------

  // GET /api/companies/:id/labels — list all labels for a company
  app.get('/:id/labels', companyScope, async (c) => {
    const companyId = c.req.param('id')

    const result = await db.query<Label>(
      `SELECT * FROM labels WHERE company_id = $1 ORDER BY name ASC`,
      [companyId],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/labels — create a label
  app.post('/:id/labels', companyScope, async (c) => {
    const companyId = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateLabelInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { name, color, description } = parsed.data

    // Check for duplicate name within company
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM labels WHERE company_id = $1 AND name = $2`,
      [companyId, name],
    )
    if (existing.rows.length > 0) {
      return c.json({ error: 'Label with this name already exists' }, 409)
    }

    const result = await db.query<Label>(
      `INSERT INTO labels (company_id, name, color, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [companyId, name, color, description ?? null],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // PUT /api/companies/:id/labels/:labelId — update a label
  app.put('/:id/labels/:labelId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const labelId = c.req.param('labelId')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateLabelInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const fields = Object.keys(updates) as (keyof typeof updates)[]

    if (fields.length === 0) {
      const result = await db.query<Label>(
        `SELECT * FROM labels WHERE id = $1 AND company_id = $2`,
        [labelId, companyId],
      )
      if (result.rows.length === 0) {
        return c.json({ error: 'Label not found' }, 404)
      }
      return c.json({ data: result.rows[0] })
    }

    // If renaming, check for duplicate
    if (updates.name) {
      const dup = await db.query<{ id: string }>(
        `SELECT id FROM labels WHERE company_id = $1 AND name = $2 AND id != $3`,
        [companyId, updates.name, labelId],
      )
      if (dup.rows.length > 0) {
        return c.json({ error: 'Label with this name already exists' }, 409)
      }
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = fields.map((f) => updates[f])

    const result = await db.query<Label>(
      `UPDATE labels SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [labelId, companyId, ...values],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Label not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/labels/:labelId — delete a label (cascades junction)
  app.delete('/:id/labels/:labelId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const labelId = c.req.param('labelId')

    const result = await db.query(
      `DELETE FROM labels WHERE id = $1 AND company_id = $2 RETURNING id`,
      [labelId, companyId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Label not found' }, 404)
    }

    return c.json({ data: { deleted: true } })
  })

  // -------------------------------------------------------------------------
  // Issue-label assignment — /api/companies/:id/issues/:issueId/labels
  // -------------------------------------------------------------------------

  // GET /api/companies/:id/issues/:issueId/labels — list labels on an issue
  app.get('/:id/issues/:issueId/labels', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    // Verify issue belongs to company
    const issueCheck = await db.query<{ id: string }>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const result = await db.query<Label>(
      `SELECT l.* FROM labels l
       INNER JOIN issue_labels il ON il.label_id = l.id
       WHERE il.issue_id = $1
       ORDER BY l.name ASC`,
      [issueId],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues/:issueId/labels — assign a label to an issue
  app.post('/:id/issues/:issueId/labels', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = AssignLabelInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { label_id } = parsed.data

    // Verify issue belongs to company
    const issueCheck = await db.query<{ id: string }>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    // Verify label belongs to same company
    const labelCheck = await db.query<{ id: string }>(
      `SELECT id FROM labels WHERE id = $1 AND company_id = $2`,
      [label_id, companyId],
    )
    if (labelCheck.rows.length === 0) {
      return c.json({ error: 'Label not found' }, 404)
    }

    // Check if already assigned
    const existing = await db.query<IssueLabel>(
      `SELECT * FROM issue_labels WHERE issue_id = $1 AND label_id = $2`,
      [issueId, label_id],
    )
    if (existing.rows.length > 0) {
      return c.json({ error: 'Label already assigned to this issue' }, 409)
    }

    await db.query(
      `INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2)`,
      [issueId, label_id],
    )

    return c.json({ data: { assigned: true } }, 201)
  })

  // DELETE /api/companies/:id/issues/:issueId/labels/:labelId — remove a label from an issue
  app.delete('/:id/issues/:issueId/labels/:labelId', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')
    const labelId = c.req.param('labelId')

    // Verify issue belongs to company
    const issueCheck = await db.query<{ id: string }>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (issueCheck.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const result = await db.query(
      `DELETE FROM issue_labels WHERE issue_id = $1 AND label_id = $2 RETURNING issue_id`,
      [issueId, labelId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Label not assigned to this issue' }, 404)
    }

    return c.json({ data: { removed: true } })
  })

  return app
}
