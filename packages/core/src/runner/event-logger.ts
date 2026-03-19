/**
 * HeartbeatEventLogger — records granular events within a heartbeat run.
 *
 * Best-effort: errors are caught and logged to console, never thrown.
 * This ensures event logging never fails the heartbeat pipeline.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { HeartbeatRunEventType, HeartbeatRunEvent } from '@shackleai/shared'

export class HeartbeatEventLogger {
  private db: DatabaseProvider
  private runId: string

  constructor(db: DatabaseProvider, runId: string) {
    this.db = db
    this.runId = runId
  }

  /**
   * Record a granular event for this heartbeat run. Fire-and-forget.
   */
  emit(eventType: HeartbeatRunEventType, payload?: Record<string, unknown>): void {
    this.insertEvent(eventType, payload).catch((err: unknown) => {
      console.error(`[HeartbeatEventLogger] Failed to log ${eventType}:`, err)
    })
  }

  private async insertEvent(
    eventType: HeartbeatRunEventType,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO heartbeat_run_events (heartbeat_run_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [this.runId, eventType, payload ? JSON.stringify(payload) : null],
    )
  }
}

/**
 * Insert a heartbeat run event (for direct use outside the executor).
 */
export async function insertHeartbeatRunEvent(
  db: DatabaseProvider,
  event: { heartbeat_run_id: string; event_type: HeartbeatRunEventType; payload?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO heartbeat_run_events (heartbeat_run_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [event.heartbeat_run_id, event.event_type, event.payload ? JSON.stringify(event.payload) : null],
  )
}

/**
 * Retrieve all events for a heartbeat run, ordered by creation time.
 */
export async function getHeartbeatRunEvents(
  db: DatabaseProvider,
  runId: string,
): Promise<HeartbeatRunEvent[]> {
  const result = await db.query<HeartbeatRunEvent>(
    `SELECT id, heartbeat_run_id, event_type, payload, created_at
     FROM heartbeat_run_events
     WHERE heartbeat_run_id = $1
     ORDER BY created_at ASC`,
    [runId],
  )
  return result.rows
}
