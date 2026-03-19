/**
 * Issue work product CRUD routes — /api/companies/:id/issues/:issueId/work-products
 *
 * Track deliverables (PRs, documents, reports, deployments) produced for an issue.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Issue, IssueWorkProduct } from '@shackleai/shared'
import { CreateWorkProductInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

/**
 * Verify the issue exists and belongs to the company.
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

export function workProductsRouter(
  db: DatabaseProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/issues/:issueId/work-products — list
  app.get('/:id/issues/:issueId/work-products', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const { limit, offset } = parsePagination(c)
    const result = await db.query<IssueWorkProduct>(
      `SELECT * FROM issue_work_products WHERE issue_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [issueId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues/:issueId/work-products — create
  app.post('/:id/issues/:issueId/work-products', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = CreateWorkProductInput.safeParse({
      issue_id: issueId,
      ...(body as object),
    })
    if (!parsed.success) {
      return c.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400,
      )
    }

    const { title, description, type, url, agent_id } = parsed.data

    const result = await db.query<IssueWorkProduct>(
      `INSERT INTO issue_work_products (issue_id, title, description, type, url, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [issueId, title, description ?? null, type, url, agent_id ?? null],
    )

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/issues/:issueId/work-products/:wpId — get single
  app.get(
    '/:id/issues/:issueId/work-products/:wpId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id')!
      const issueId = c.req.param('issueId')!
      const wpId = c.req.param('wpId')!

      const found = await verifyIssueOwnership(db, issueId, companyId)
      if (!found) {
        return c.json({ error: 'Issue not found' }, 404)
      }

      const result = await db.query<IssueWorkProduct>(
        `SELECT * FROM issue_work_products WHERE id = $1 AND issue_id = $2`,
        [wpId, issueId],
      )

      if (result.rows.length === 0) {
        return c.json({ error: 'Work product not found' }, 404)
      }

      return c.json({ data: result.rows[0] })
    },
  )

  // DELETE /api/companies/:id/issues/:issueId/work-products/:wpId — delete
  app.delete(
    '/:id/issues/:issueId/work-products/:wpId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id')!
      const issueId = c.req.param('issueId')!
      const wpId = c.req.param('wpId')!

      const found = await verifyIssueOwnership(db, issueId, companyId)
      if (!found) {
        return c.json({ error: 'Issue not found' }, 404)
      }

      const result = await db.query<IssueWorkProduct>(
        `DELETE FROM issue_work_products WHERE id = $1 AND issue_id = $2 RETURNING *`,
        [wpId, issueId],
      )

      if (result.rows.length === 0) {
        return c.json({ error: 'Work product not found' }, 404)
      }

      return c.json({ data: result.rows[0] })
    },
  )

  return app
}
