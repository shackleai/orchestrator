/**
 * Observatory — fire-and-forget event logging and immutable activity trail.
 *
 * Design principles:
 * - logEvent / logActivity NEVER throw — errors are silently caught (console.error at most).
 * - logEvent / logActivity NEVER block the caller — they return void, not a Promise.
 * - getEvents / getActivity return queried data with optional filters.
 * - All queries are parameterized — no string concatenation.
 * - All queries are scoped to company_id (multi-tenant).
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { ActivityLogEntry } from '@shackleai/shared'

export interface LogEventInput {
  company_id: string
  entity_type: string
  entity_id?: string
  actor_type: string
  actor_id?: string
  action: string
  changes?: Record<string, unknown>
}

export interface EventFilters {
  entityType?: string
  entityId?: string
  startDate?: Date
  endDate?: Date
  limit?: number
}

export interface ActivityFilters {
  actorType?: string
  actorId?: string
  action?: string
  startDate?: Date
  endDate?: Date
  limit?: number
}

export class Observatory {
  private db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  /**
   * Log an event to activity_log. Fire-and-forget — never throws, never blocks.
   */
  logEvent(event: LogEventInput): void {
    this.insertEvent(event).catch((err: unknown) => {
      console.error('[Observatory] logEvent failed:', err)
    })
  }

  /**
   * Log an activity entry. Fire-and-forget — never throws, never blocks.
   * Immutable: activity_log has no UPDATE/DELETE operations.
   */
  logActivity(entry: Omit<ActivityLogEntry, 'id' | 'created_at'>): void {
    this.insertActivity(entry).catch((err: unknown) => {
      console.error('[Observatory] logActivity failed:', err)
    })
  }

  /**
   * Query events from activity_log with optional filters, scoped to a company.
   */
  async getEvents(
    companyId: string,
    filters?: EventFilters,
  ): Promise<ActivityLogEntry[]> {
    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let idx = 2

    if (filters?.entityType) {
      conditions.push(`entity_type = $${idx}`)
      params.push(filters.entityType)
      idx++
    }

    if (filters?.entityId) {
      conditions.push(`entity_id = $${idx}`)
      params.push(filters.entityId)
      idx++
    }

    if (filters?.startDate) {
      conditions.push(`created_at >= $${idx}`)
      params.push(filters.startDate.toISOString())
      idx++
    }

    if (filters?.endDate) {
      conditions.push(`created_at <= $${idx}`)
      params.push(filters.endDate.toISOString())
      idx++
    }

    const limit = filters?.limit ?? 100
    const sql = `
      SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at
      FROM activity_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${idx}
    `
    params.push(limit)

    const result = await this.db.query<ActivityLogEntry>(sql, params)
    return result.rows
  }

  /**
   * Query activity from activity_log with actor-oriented filters, scoped to a company.
   */
  async getActivity(
    companyId: string,
    filters?: ActivityFilters,
  ): Promise<ActivityLogEntry[]> {
    const conditions: string[] = ['company_id = $1']
    const params: unknown[] = [companyId]
    let idx = 2

    if (filters?.actorType) {
      conditions.push(`actor_type = $${idx}`)
      params.push(filters.actorType)
      idx++
    }

    if (filters?.actorId) {
      conditions.push(`actor_id = $${idx}`)
      params.push(filters.actorId)
      idx++
    }

    if (filters?.action) {
      conditions.push(`action = $${idx}`)
      params.push(filters.action)
      idx++
    }

    if (filters?.startDate) {
      conditions.push(`created_at >= $${idx}`)
      params.push(filters.startDate.toISOString())
      idx++
    }

    if (filters?.endDate) {
      conditions.push(`created_at <= $${idx}`)
      params.push(filters.endDate.toISOString())
      idx++
    }

    const limit = filters?.limit ?? 100
    const sql = `
      SELECT id, company_id, entity_type, entity_id, actor_type, actor_id, action, changes, created_at
      FROM activity_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${idx}
    `
    params.push(limit)

    const result = await this.db.query<ActivityLogEntry>(sql, params)
    return result.rows
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async insertEvent(event: LogEventInput): Promise<void> {
    await this.db.query(
      `INSERT INTO activity_log (company_id, entity_type, entity_id, actor_type, actor_id, action, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.company_id,
        event.entity_type,
        event.entity_id ?? null,
        event.actor_type,
        event.actor_id ?? null,
        event.action,
        event.changes ? JSON.stringify(event.changes) : null,
      ],
    )
  }

  private async insertActivity(
    entry: Omit<ActivityLogEntry, 'id' | 'created_at'>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO activity_log (company_id, entity_type, entity_id, actor_type, actor_id, action, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.company_id,
        entry.entity_type,
        entry.entity_id ?? null,
        entry.actor_type,
        entry.actor_id ?? null,
        entry.action,
        entry.changes ? JSON.stringify(entry.changes) : null,
      ],
    )
  }
}
