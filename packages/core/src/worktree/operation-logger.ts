/**
 * WorkspaceOperationLogger — immutable audit trail for agent workspace activity.
 *
 * All operations are INSERT-only; no UPDATE or DELETE is exposed.
 * Logging is non-blocking: errors are swallowed so a failed log entry
 * never interrupts the operation being audited.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseProvider } from '@shackleai/db'
import type { WorkspaceOperation, WorkspaceOperationType } from '@shackleai/shared'

export interface LogOperationInput {
  workspaceId: string
  agentId: string
  operationType: WorkspaceOperationType
  filePath?: string | null
  details?: Record<string, unknown>
}

export interface OperationFilters {
  operationType?: WorkspaceOperationType
  agentId?: string
  since?: string
}

export class WorkspaceOperationLogger {
  private db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  /**
   * Append an operation to the immutable log.
   * Returns the created record, or null if logging failed (non-blocking).
   */
  async log(input: LogOperationInput): Promise<WorkspaceOperation | null> {
    try {
      const id = randomUUID()
      const result = await this.db.query<WorkspaceOperation>(
        `INSERT INTO workspace_operations
           (id, workspace_id, agent_id, operation_type, file_path, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          input.workspaceId,
          input.agentId,
          input.operationType,
          input.filePath ?? null,
          JSON.stringify(input.details ?? {}),
        ],
      )
      return result.rows[0] ?? null
    } catch (err) {
      console.error(
        '[WorkspaceOperationLogger] Failed to log operation:',
        err instanceof Error ? err.message : err,
      )
      return null
    }
  }

  /**
   * List operations for a workspace with optional filters.
   * Supports filtering by operation_type, agent_id, and since (ISO timestamp).
   */
  async list(
    workspaceId: string,
    filters?: OperationFilters,
    pagination?: { limit: number; offset: number },
  ): Promise<WorkspaceOperation[]> {
    const limit = pagination?.limit ?? 100
    const offset = pagination?.offset ?? 0

    const conditions: string[] = ['workspace_id = $1']
    const params: unknown[] = [workspaceId]
    let paramIndex = 2

    if (filters?.operationType) {
      conditions.push(`operation_type = $${paramIndex++}`)
      params.push(filters.operationType)
    }

    if (filters?.agentId) {
      conditions.push(`agent_id = $${paramIndex++}`)
      params.push(filters.agentId)
    }

    if (filters?.since) {
      conditions.push(`created_at > $${paramIndex++}`)
      params.push(filters.since)
    }

    const where = conditions.join(' AND ')
    const result = await this.db.query<WorkspaceOperation>(
      `SELECT * FROM workspace_operations
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    )

    return result.rows
  }

  /**
   * Count operations for a workspace with optional filters.
   */
  async count(
    workspaceId: string,
    filters?: OperationFilters,
  ): Promise<number> {
    const conditions: string[] = ['workspace_id = $1']
    const params: unknown[] = [workspaceId]
    let paramIndex = 2

    if (filters?.operationType) {
      conditions.push(`operation_type = $${paramIndex++}`)
      params.push(filters.operationType)
    }

    if (filters?.agentId) {
      conditions.push(`agent_id = $${paramIndex++}`)
      params.push(filters.agentId)
    }

    if (filters?.since) {
      conditions.push(`created_at > $${paramIndex++}`)
      params.push(filters.since)
    }

    const where = conditions.join(' AND ')
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM workspace_operations WHERE ${where}`,
      params,
    )

    return parseInt(result.rows[0]?.count ?? '0', 10)
  }
}
