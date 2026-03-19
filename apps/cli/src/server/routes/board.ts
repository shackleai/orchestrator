/**
 * Board claim routes — /api/companies/:id/board
 *
 * Implements human operator authority over a company. When a user claims
 * the board, guarded mutations (agent hire/fire, budget, policy, settings)
 * require that user's JWT — agents and other users are blocked.
 */

import { Hono } from 'hono'
import type { DatabaseProvider } from '@shackleai/db'
import type { Company, BoardStatus, User } from '@shackleai/shared'
import type { CompanyScopeVariables } from '../middleware/company-scope.js'
import { companyScope } from '../middleware/company-scope.js'
import { humanAuth, type HumanAuthVariables } from '../middleware/human-auth.js'

type Variables = CompanyScopeVariables & HumanAuthVariables

export function boardRouter(db: DatabaseProvider): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Inject db into context for all routes
  app.use('*', async (c, next) => {
    c.set('db', db)
    return next()
  })

  // POST /api/companies/:id/board/claim — claim board authority
  app.post('/:id/board/claim', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    // If already claimed by someone else, reject
    if (company.board_claimed_by && company.board_claimed_by !== userId) {
      // Look up who holds it
      const holder = await db.query<User>(
        'SELECT name, email FROM users WHERE id = $1',
        [company.board_claimed_by],
      )
      const holderName = holder.rows[0]?.name ?? 'unknown'
      const holderEmail = holder.rows[0]?.email ?? 'unknown'

      return c.json(
        {
          error: 'Board already claimed',
          detail: `The board is currently held by ${holderName} (${holderEmail}). They must release it first.`,
        },
        409,
      )
    }

    // If already claimed by this user, idempotent success
    if (company.board_claimed_by === userId) {
      return c.json({ data: { message: 'Board already claimed by you' } })
    }

    // Claim the board
    const result = await db.query<Company>(
      `UPDATE companies
       SET board_claimed_by = $1, board_claimed_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [userId, company.id],
    )

    return c.json({ data: { message: 'Board claimed', company_id: result.rows[0].id } })
  })

  // POST /api/companies/:id/board/release — release board authority
  app.post('/:id/board/release', companyScope, humanAuth, async (c) => {
    const company = c.get('company')
    const userId = c.get('userId')

    // If not claimed, nothing to release
    if (!company.board_claimed_by) {
      return c.json({ data: { message: 'Board is not currently claimed' } })
    }

    // Only the holder can release (or an admin — future enhancement)
    if (company.board_claimed_by !== userId) {
      return c.json(
        {
          error: 'Forbidden',
          detail: 'Only the current board holder can release the board.',
        },
        403,
      )
    }

    await db.query(
      `UPDATE companies
       SET board_claimed_by = NULL, board_claimed_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [company.id],
    )

    return c.json({ data: { message: 'Board released' } })
  })

  // GET /api/companies/:id/board/status — check board authority
  app.get('/:id/board/status', companyScope, async (c) => {
    const company = c.get('company')

    if (!company.board_claimed_by) {
      const status: BoardStatus = {
        claimed: false,
        claimed_by: null,
        claimed_at: null,
        user_name: null,
        user_email: null,
      }
      return c.json({ data: status })
    }

    // Look up the claiming user's public info
    const holder = await db.query<User>(
      'SELECT name, email FROM users WHERE id = $1',
      [company.board_claimed_by],
    )

    const status: BoardStatus = {
      claimed: true,
      claimed_by: company.board_claimed_by,
      claimed_at: company.board_claimed_at?.toISOString() ?? null,
      user_name: holder.rows[0]?.name ?? null,
      user_email: holder.rows[0]?.email ?? null,
    }

    return c.json({ data: status })
  })

  return app
}
