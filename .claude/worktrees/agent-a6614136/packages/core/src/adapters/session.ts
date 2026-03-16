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
 */
export async function saveSessionState(
  heartbeatRunId: string,
  sessionState: string,
  db: DatabaseProvider,
): Promise<void> {
  await db.query(
    `UPDATE heartbeat_runs SET session_id_after = $1 WHERE id = $2`,
    [sessionState, heartbeatRunId],
  )
}
