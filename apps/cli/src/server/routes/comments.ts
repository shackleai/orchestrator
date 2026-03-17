/**
 * Comment CRUD routes — /api/companies/:id/issues/:issueId/comments
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Issue, IssueComment } from '@shackleai/shared'
import { CreateIssueCommentInput, TriggerType } from '@shackleai/shared'
import type { Scheduler } from '@shackleai/core'
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

export function commentsRouter(db: DatabaseProvider, scheduler?: Scheduler): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/issues/:issueId/comments — list comments (paginated)
  app.get('/:id/issues/:issueId/comments', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const { limit, offset } = parsePagination(c)
    const result = await db.query<IssueComment>(
      `SELECT * FROM issue_comments WHERE issue_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [issueId, limit, offset],
    )

    return c.json({ data: result.rows })
  })

  // POST /api/companies/:id/issues/:issueId/comments — create comment
  app.post('/:id/issues/:issueId/comments', companyScope, async (c) => {
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

    const parsed = CreateIssueCommentInput.safeParse({ issue_id: issueId, ...(body as object) })
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const { content, author_agent_id, parent_id, is_resolved } = parsed.data

    const result = await db.query<IssueComment>(
      `INSERT INTO issue_comments (issue_id, author_agent_id, content, parent_id, is_resolved)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [issueId, author_agent_id ?? null, content, parent_id ?? null, is_resolved],
    )

    // Trigger mentioned agents — scan for @agent-name patterns
    if (scheduler) {
      const mentions = content.match(/@([\w-]+)/g)
      if (mentions) {
        const uniqueNames = [...new Set(mentions.map((m) => m.slice(1)))]
        for (const agentName of uniqueNames) {
          const agentResult = await db.query<{ id: string }>(
            `SELECT id FROM agents WHERE company_id = $1 AND name = $2`,
            [companyId, agentName],
          )
          if (agentResult.rows.length > 0) {
            void scheduler.triggerNow(agentResult.rows[0].id, TriggerType.Mentioned)
          }
        }
      }
    }

    return c.json({ data: result.rows[0] }, 201)
  })

  // GET /api/companies/:id/issues/:issueId/comments/:cid — get single comment
  app.get('/:id/issues/:issueId/comments/:cid', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!
    const commentId = c.req.param('cid')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const result = await db.query<IssueComment>(
      `SELECT * FROM issue_comments WHERE id = $1 AND issue_id = $2`,
      [commentId, issueId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Comment not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  // DELETE /api/companies/:id/issues/:issueId/comments/:cid — delete comment
  app.delete('/:id/issues/:issueId/comments/:cid', companyScope, async (c) => {
    const companyId = c.req.param('id')!
    const issueId = c.req.param('issueId')!
    const commentId = c.req.param('cid')!

    const found = await verifyIssueOwnership(db, issueId, companyId)
    if (!found) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const result = await db.query<IssueComment>(
      `DELETE FROM issue_comments WHERE id = $1 AND issue_id = $2 RETURNING *`,
      [commentId, issueId],
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'Comment not found' }, 404)
    }

    return c.json({ data: result.rows[0] })
  })

  return app
}
