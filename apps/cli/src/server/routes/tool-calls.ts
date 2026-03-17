/**
 * Tool call routes — /api/companies/:id/tool-calls
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { ToolCall } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { parsePagination } from '../pagination.js'

type Variables = CompanyScopeVariables

export function toolCallsRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // GET /api/companies/:id/tool-calls — list tool calls with optional filters
  app.get('/:id/tool-calls', companyScope, async (c) => {
    const companyId = c.req.param('id')
    const { limit, offset } = parsePagination(c)

    const agentId = c.req.query('agent_id')
    const runId = c.req.query('run_id')
    const toolName = c.req.query('tool_name')

    // Build dynamic WHERE clause with parameterized queries
    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let paramIdx = 2

    if (agentId) {
      conditions.push(`agent_id = $${paramIdx}`)
      params.push(agentId)
      paramIdx++
    }

    if (runId) {
      conditions.push(`heartbeat_run_id = $${paramIdx}`)
      params.push(runId)
      paramIdx++
    }

    if (toolName) {
      conditions.push(`tool_name = $${paramIdx}`)
      params.push(toolName)
      paramIdx++
    }

    const where = conditions.join(' AND ')
    params.push(limit, offset)

    const result = await db.query<ToolCall>(
      `SELECT * FROM tool_calls WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params,
    )

    return c.json({ data: result.rows })
  })

  return app
}
