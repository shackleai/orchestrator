/**
 * Workspace operation log routes — /api/companies/:id/worktrees/:wtId/operations
 *
 * Immutable audit trail: GET (list) and POST (append) only. No UPDATE or DELETE.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { AgentWorktree, WorkspaceOperationType } from '@shackleai/shared'
import { CreateWorkspaceOperationInput } from '@shackleai/shared'
import { WorkspaceOperationLogger } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function workspaceOperationsRouter(
  db: DatabaseProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()
  const logger = new WorkspaceOperationLogger(db)

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/worktrees/:wtId/operations — list operations for a workspace
  app.get(
    '/:id/worktrees/:wtId/operations',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const wtId = c.req.param('wtId') as string

      // Verify worktree exists and belongs to company
      const wtResult = await db.query<AgentWorktree>(
        'SELECT id FROM agent_worktrees WHERE id = $1 AND company_id = $2',
        [wtId, companyId],
      )
      if (wtResult.rows.length === 0) {
        return c.json({ error: 'Worktree not found' }, 404)
      }

      const { limit, offset } = parsePagination(c)

      // Parse optional filters from query params
      const operationType = c.req.query('operation_type') as
        | WorkspaceOperationType
        | undefined
      const agentId = c.req.query('agent_id')
      const since = c.req.query('since')

      const operations = await logger.list(
        wtId,
        {
          operationType,
          agentId: agentId ?? undefined,
          since: since ?? undefined,
        },
        { limit, offset },
      )

      return c.json({ data: operations })
    },
  )

  // POST /api/companies/:id/worktrees/:wtId/operations — log a new operation (append-only)
  app.post(
    '/:id/worktrees/:wtId/operations',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const wtId = c.req.param('wtId') as string

      // Verify worktree exists and belongs to company
      const wtResult = await db.query<AgentWorktree>(
        'SELECT id, agent_id FROM agent_worktrees WHERE id = $1 AND company_id = $2',
        [wtId, companyId],
      )
      if (wtResult.rows.length === 0) {
        return c.json({ error: 'Worktree not found' }, 404)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
      }

      const parsed = CreateWorkspaceOperationInput.safeParse({
        workspace_id: wtId,
        agent_id: wtResult.rows[0].agent_id,
        ...(body as object),
      })
      if (!parsed.success) {
        return c.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          400,
        )
      }

      const operation = await logger.log({
        workspaceId: parsed.data.workspace_id,
        agentId: parsed.data.agent_id,
        operationType: parsed.data.operation_type as WorkspaceOperationType,
        filePath: parsed.data.file_path,
        details: parsed.data.details,
      })

      if (!operation) {
        return c.json({ error: 'Failed to log operation' }, 500)
      }

      return c.json({ data: operation }, 201)
    },
  )

  return app
}
