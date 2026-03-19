/**
 * Inbox / notification center routes
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { InboxItem, IssueReadState, Issue, Approval, IssueComment } from '@shackleai/shared'
import { MarkReadInput } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function inboxRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // POST /api/companies/:id/issues/:issueId/read
  app.post('/:id/issues/:issueId/read', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const issueId = c.req.param('issueId')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = MarkReadInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const existing = await db.query<Pick<Issue, 'id'>>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (existing.rows.length === 0) {
      return c.json({ error: 'Issue not found' }, 404)
    }

    const result = await db.query<IssueReadState>(
      `INSERT INTO issue_read_states (issue_id, user_or_agent_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (issue_id, user_or_agent_id)
       DO UPDATE SET last_read_at = NOW()
       RETURNING *`,
      [issueId, parsed.data.user_or_agent_id],
    )

    return c.json({ data: result.rows[0] })
  })

  // GET /api/companies/:id/inbox
  app.get('/:id/inbox', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const userId = c.req.query('user_or_agent_id')

    if (!userId) {
      return c.json({ error: 'user_or_agent_id query parameter is required' }, 400)
    }

    const items: InboxItem[] = []

    const unreadIssues = await db.query<Pick<Issue, 'id' | 'identifier' | 'title' | 'status' | 'priority' | 'updated_at'>>(
      `SELECT i.id, i.identifier, i.title, i.status, i.priority, i.updated_at
       FROM issues i
       LEFT JOIN issue_read_states rs
         ON rs.issue_id = i.id AND rs.user_or_agent_id = $2
       WHERE i.company_id = $1
         AND (rs.last_read_at IS NULL OR i.updated_at > rs.last_read_at)
       ORDER BY i.updated_at DESC
       LIMIT 50`,
      [companyId, userId],
    )

    for (const issue of unreadIssues.rows) {
      items.push({
        type: 'unread_issue',
        id: issue.id,
        title: `${issue.identifier}: ${issue.title}`,
        timestamp: String(issue.updated_at),
        meta: { status: issue.status, priority: issue.priority, identifier: issue.identifier },
      })
    }

    const pendingApprovals = await db.query<Pick<Approval, 'id' | 'type' | 'payload' | 'created_at'>>(
      `SELECT id, type, payload, created_at
       FROM approvals
       WHERE company_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`,
      [companyId],
    )

    for (const approval of pendingApprovals.rows) {
      const payload = typeof approval.payload === 'string'
        ? JSON.parse(approval.payload as string)
        : approval.payload
      items.push({
        type: 'pending_approval',
        id: approval.id,
        title: `Approval required: ${approval.type}${payload?.name ? ` -- ${payload.name}` : ''}`,
        timestamp: String(approval.created_at),
        meta: { approval_type: approval.type },
      })
    }

    const newComments = await db.query<
      Pick<IssueComment, 'id' | 'content' | 'created_at'> & { issue_title: string; issue_identifier: string; issue_id: string }
    >(
      `SELECT c.id, c.content, c.created_at, i.title AS issue_title, i.identifier AS issue_identifier, i.id AS issue_id
       FROM issue_comments c
       INNER JOIN issues i ON i.id = c.issue_id
       LEFT JOIN issue_read_states rs
         ON rs.issue_id = c.issue_id AND rs.user_or_agent_id = $2
       WHERE i.company_id = $1
         AND i.assignee_agent_id = $2
         AND (rs.last_read_at IS NULL OR c.created_at > rs.last_read_at)
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [companyId, userId],
    )

    for (const comment of newComments.rows) {
      items.push({
        type: 'new_comment',
        id: comment.id,
        title: `Comment on ${comment.issue_identifier}: ${comment.content.slice(0, 80)}${comment.content.length > 80 ? '...' : ''}`,
        timestamp: String(comment.created_at),
        meta: { issue_id: comment.issue_id, issue_identifier: comment.issue_identifier },
      })
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return c.json({ data: items })
  })

  // GET /api/companies/:id/inbox/count
  app.get('/:id/inbox/count', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const userId = c.req.query('user_or_agent_id')

    if (!userId) {
      return c.json({ error: 'user_or_agent_id query parameter is required' }, 400)
    }

    const unreadResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM issues i
       LEFT JOIN issue_read_states rs
         ON rs.issue_id = i.id AND rs.user_or_agent_id = $2
       WHERE i.company_id = $1
         AND (rs.last_read_at IS NULL OR i.updated_at > rs.last_read_at)`,
      [companyId, userId],
    )

    const approvalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM approvals
       WHERE company_id = $1 AND status = 'pending'`,
      [companyId],
    )

    const commentResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM issue_comments c
       INNER JOIN issues i ON i.id = c.issue_id
       LEFT JOIN issue_read_states rs
         ON rs.issue_id = c.issue_id AND rs.user_or_agent_id = $2
       WHERE i.company_id = $1
         AND i.assignee_agent_id = $2
         AND (rs.last_read_at IS NULL OR c.created_at > rs.last_read_at)`,
      [companyId, userId],
    )

    const unread_issues = parseInt(unreadResult.rows[0].count, 10)
    const pending_approvals = parseInt(approvalResult.rows[0].count, 10)
    const new_comments = parseInt(commentResult.rows[0].count, 10)

    return c.json({
      data: {
        unread_issues,
        pending_approvals,
        new_comments,
        total: unread_issues + pending_approvals + new_comments,
      },
    })
  })

  return app
}
