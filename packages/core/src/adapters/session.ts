/**
 * SessionManager — save and restore session state across heartbeat runs.
 *
 * Session state is stored in the heartbeat_runs table's session_id_after column.
 * Before each heartbeat, the scheduler can look up the last successful run's
 * session state and pass it to the adapter as `ctx.sessionState`.
 */

import type { DatabaseProvider } from '@shackleai/db'

/**
 * Get the session state from the last successful heartbeat run for an agent.
 * Returns null if no prior successful run exists.
 *
 * The raw string is returned as-is. Callers that stored JSON via
 * `saveSessionState` can parse it themselves (the round-trip is lossless).
 */
export async function getLastSessionState(
  agentId: string,
  db: DatabaseProvider,
): Promise<string | null> {
  const result = await db.query<{ session_id_after: string | null }>(
    `SELECT session_id_after
     FROM heartbeat_runs
     WHERE agent_id = $1 AND status = 'success' AND session_id_after IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`,
    [agentId],
  )

  if (result.rows.length === 0) {
    return null
  }

  return result.rows[0].session_id_after
}

/**
 * Save session state after a heartbeat run completes.
 * Updates the heartbeat_run's session_id_after column.
 *
 * If the value is an object, it is JSON.stringified before storage.
 */
export async function saveSessionState(
  heartbeatRunId: string,
  sessionState: string | Record<string, unknown>,
  db: DatabaseProvider,
): Promise<void> {
  const serialized =
    typeof sessionState === 'object' ? JSON.stringify(sessionState) : sessionState

  await db.query(
    `UPDATE heartbeat_runs SET session_id_after = $1 WHERE id = $2`,
    [serialized, heartbeatRunId],
  )
}

/** Default context limit in estimated tokens. */
const DEFAULT_CONTEXT_LIMIT = 100_000

/** Rough token estimate: 1 token ~= 4 characters. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Compact a session state string if it exceeds the token limit.
 *
 * Session state is treated as a JSON string. If it parses as an array
 * (e.g. a list of messages), older entries are truncated to fit under the
 * limit while keeping the most recent entries. If it parses as an object
 * with a `messages` array, only that array is trimmed.
 *
 * For non-parseable or non-array session states that exceed the limit,
 * the string is truncated from the front (keeping the most recent tail).
 *
 * Returns the (possibly compacted) session state, or null if input is null.
 */
export function compactSession(
  sessionState: string | null,
  contextLimit: number = DEFAULT_CONTEXT_LIMIT,
): string | null {
  if (!sessionState) return null

  const currentTokens = estimateTokens(sessionState)
  if (currentTokens <= contextLimit) return sessionState

  // Try to parse as JSON for structured compaction
  try {
    const parsed = JSON.parse(sessionState) as unknown

    // Case 1: Top-level array (e.g. message list)
    if (Array.isArray(parsed)) {
      const compacted = truncateArray(parsed, contextLimit)
      return JSON.stringify(compacted)
    }

    // Case 2: Object with a `messages` array
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'messages' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).messages)
    ) {
      const obj = parsed as Record<string, unknown>
      const messages = obj.messages as unknown[]
      const compacted = { ...obj, messages: truncateArray(messages, contextLimit) }
      return JSON.stringify(compacted)
    }
  } catch {
    // Not valid JSON — fall through to string truncation
  }

  // Fallback: truncate the raw string from the front, keeping the tail
  const maxChars = contextLimit * 4
  if (sessionState.length > maxChars) {
    return sessionState.slice(-maxChars)
  }

  return sessionState
}

/**
 * Remove elements from the front of an array until the JSON-serialized
 * result fits within the token limit.
 */
function truncateArray(arr: unknown[], contextLimit: number): unknown[] {
  let items = arr
  while (items.length > 1) {
    const serialized = JSON.stringify(items)
    if (estimateTokens(serialized) <= contextLimit) break
    // Drop the oldest entry (first element)
    items = items.slice(1)
  }
  return items
}
