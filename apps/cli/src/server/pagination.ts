/**
 * Shared pagination helper for list endpoints.
 *
 * Parses `limit` and `offset` query params with safe defaults and bounds.
 */

import type { Context } from 'hono'

export interface PaginationParams {
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

/**
 * Parse pagination params from a Hono request context.
 *
 * - `limit`: clamped to [1, 1000], default 100
 * - `offset`: clamped to [0, Infinity), default 0
 */
export function parsePagination(c: Context): PaginationParams {
  const rawLimit = c.req.query('limit')
  const rawOffset = c.req.query('offset')

  const limit = rawLimit
    ? Math.min(Math.max(parseInt(rawLimit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const offset = rawOffset ? Math.max(parseInt(rawOffset, 10) || 0, 0) : 0

  return { limit, offset }
}
