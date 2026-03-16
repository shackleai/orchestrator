/**
 * Worktree CRUD routes — /api/companies/:id/agents/:agentId/worktrees
 * and /api/companies/:id/worktrees/cleanup
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Agent } from '@shackleai/shared'
import {
  CreateWorktreeInput,
  WorktreeCleanupInput,
} from '@shackleai/shared'
import { WorktreeManager } from '@shackleai/core'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'

type Variables = CompanyScopeVariables

export function worktreesRouter(
  db: DatabaseProvider,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()
  const manager = new WorktreeManager(db)

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/agents/:agentId/worktrees — list worktrees for an agent
  app.get(
    '/:id/agents/:agentId/worktrees',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const agentId = c.req.param('agentId') as string

      // Verify agent exists and belongs to company
      const agentResult = await db.query<Agent>(
        `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
        [agentId, companyId],
      )
      if (agentResult.rows.length === 0) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      const worktrees = await manager.list(companyId, agentId)
      return c.json({ data: worktrees })
    },
  )

  // POST /api/companies/:id/agents/:agentId/worktrees — create worktree
  app.post(
    '/:id/agents/:agentId/worktrees',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const agentId = c.req.param('agentId') as string

      // Verify agent exists and belongs to company
      const agentResult = await db.query<Agent>(
        `SELECT id FROM agents WHERE id = $1 AND company_id = $2`,
        [agentId, companyId],
      )
      if (agentResult.rows.length === 0) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
      }

      const parsed = CreateWorktreeInput.safeParse({
        agent_id: agentId,
        company_id: companyId,
        ...(body as object),
      })
      if (!parsed.success) {
        return c.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          400,
        )
      }

      try {
        const info = await manager.create({
          repoPath: parsed.data.repo_path,
          agentId,
          companyId,
          branchName: parsed.data.branch,
          baseBranch: parsed.data.base_branch,
          issueId: parsed.data.issue_id ?? undefined,
        })
        return c.json({ data: info }, 201)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        // Free tier limit — return 402
        if (message.includes('Free tier limit')) {
          return c.json({ error: message }, 402)
        }

        return c.json({ error: message }, 400)
      }
    },
  )

  // GET /api/companies/:id/agents/:agentId/worktrees/:wtId — worktree detail
  app.get(
    '/:id/agents/:agentId/worktrees/:wtId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const agentId = c.req.param('agentId') as string
      const wtId = c.req.param('wtId') as string

      const record = await manager.getById(wtId)
      if (
        !record ||
        record.company_id !== companyId ||
        record.agent_id !== agentId
      ) {
        return c.json({ error: 'Worktree not found' }, 404)
      }

      const info = await manager.get(record.worktree_path)
      return c.json({ data: info ?? record })
    },
  )

  // DELETE /api/companies/:id/agents/:agentId/worktrees/:wtId — destroy worktree
  app.delete(
    '/:id/agents/:agentId/worktrees/:wtId',
    companyScope,
    async (c) => {
      const companyId = c.req.param('id') as string
      const agentId = c.req.param('agentId') as string
      const wtId = c.req.param('wtId') as string

      const record = await manager.getById(wtId)
      if (
        !record ||
        record.company_id !== companyId ||
        record.agent_id !== agentId
      ) {
        return c.json({ error: 'Worktree not found' }, 404)
      }

      try {
        await manager.destroy(record.worktree_path)
        return c.json({ data: { deleted: true } })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: message }, 500)
      }
    },
  )

  // POST /api/companies/:id/worktrees/cleanup — trigger cleanup
  app.post('/:id/worktrees/cleanup', companyScope, async (c) => {
    const companyId = c.req.param('id') as string

    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // Body is optional
    }

    const parsed = WorktreeCleanupInput.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400,
      )
    }

    try {
      const result = await manager.cleanup(companyId, {
        dryRun: parsed.data.dry_run,
        maxAgeMs: parsed.data.max_age_ms,
      })
      return c.json({ data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return app
}
