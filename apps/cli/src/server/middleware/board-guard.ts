/**
 * Board guard middleware — blocks mutations that require board authority.
 *
 * When the board is claimed by a user, certain mutations (agent create/delete,
 * budget changes, policy changes, company settings) require that the request
 * is from the user who holds the board claim.
 *
 * Must be applied AFTER humanAuth middleware (needs userId in context).
 * Must be applied AFTER companyScope middleware (needs company in context).
 */

import type { Context, Next } from 'hono'
import type { Company } from '@shackleai/shared'
import type { BoardGuardedMutation } from '@shackleai/shared'

export type BoardGuardVariables = {
  userId: string
  company: Company
}

/**
 * Factory that creates a board guard middleware for a specific mutation type.
 *
 * @param mutationType — The mutation being guarded (for error messages)
 */
export function requireBoardAuthority(mutationType: BoardGuardedMutation) {
  return async (
    c: Context<{ Variables: BoardGuardVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const company = c.get('company')

    // If no board claim exists, the mutation is allowed (no human oversight active)
    if (!company.board_claimed_by) {
      return next()
    }

    const userId = c.get('userId')

    // If the board is claimed, only the board holder can perform guarded mutations
    if (!userId) {
      return c.json(
        {
          error: 'Board authority required',
          detail: `Mutation "${mutationType}" requires board authority. The board is currently claimed by another user.`,
        },
        403,
      )
    }

    if (company.board_claimed_by !== userId) {
      return c.json(
        {
          error: 'Board authority required',
          detail: `Mutation "${mutationType}" requires board authority. The board is currently claimed by another user.`,
        },
        403,
      )
    }

    return next()
  }
}
