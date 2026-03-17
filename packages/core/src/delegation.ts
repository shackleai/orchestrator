/**
 * DelegationService — agent hierarchy-based task delegation.
 *
 * Enables managers to delegate issues to their direct reports by creating
 * child issues assigned to the target agent. Also provides roll-up logic
 * to auto-complete parent issues when all children are done.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { Issue } from '@shackleai/shared'
import { IssueStatus } from '@shackleai/shared'

interface AgentReportsTo {
  reports_to: string | null
}

interface CompanyCounter {
  issue_prefix: string
  issue_counter: number
}

export class DelegationService {
  constructor(private db: DatabaseProvider) {}

  /**
   * Check if fromAgent can delegate to toAgent.
   * Valid if toAgent.reports_to === fromAgent.id (direct report).
   */
  async canDelegate(
    fromAgentId: string,
    toAgentId: string,
  ): Promise<boolean> {
    const result = await this.db.query<AgentReportsTo>(
      `SELECT reports_to FROM agents WHERE id = $1`,
      [toAgentId],
    )

    if (result.rows.length === 0) return false

    return result.rows[0].reports_to === fromAgentId
  }

  /**
   * Delegate: create child issues assigned to toAgent.
   * - Validates hierarchy (toAgent must report to fromAgent)
   * - Creates child issues with parent_id set to the original issue
   * - Assigns to toAgent with status 'todo'
   * - Returns created issue IDs
   */
  async delegate(
    companyId: string,
    fromAgentId: string,
    issueId: string,
    toAgentId: string,
    subTasks: Array<{ title: string; description?: string | null }>,
  ): Promise<string[]> {
    const allowed = await this.canDelegate(fromAgentId, toAgentId)
    if (!allowed) {
      throw new DelegationError(
        `Agent ${toAgentId} does not report to ${fromAgentId}`,
      )
    }

    // Verify the parent issue exists and belongs to the company
    const parentResult = await this.db.query<Pick<Issue, 'id'>>(
      `SELECT id FROM issues WHERE id = $1 AND company_id = $2`,
      [issueId, companyId],
    )
    if (parentResult.rows.length === 0) {
      throw new DelegationError('Parent issue not found')
    }

    const childIds: string[] = []

    for (const task of subTasks) {
      // Atomically increment company issue_counter
      const counterResult = await this.db.query<CompanyCounter>(
        `UPDATE companies SET issue_counter = issue_counter + 1 WHERE id = $1
         RETURNING issue_prefix, issue_counter`,
        [companyId],
      )

      if (counterResult.rows.length === 0) {
        throw new DelegationError('Company not found')
      }

      const { issue_prefix, issue_counter } = counterResult.rows[0]
      const identifier = `${issue_prefix}-${issue_counter}`

      const insertResult = await this.db.query<Pick<Issue, 'id'>>(
        `INSERT INTO issues
           (company_id, identifier, issue_number, title, description, parent_id,
            status, priority, assignee_agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          companyId,
          identifier,
          issue_counter,
          task.title,
          task.description ?? null,
          issueId,
          IssueStatus.Todo,
          'medium',
          toAgentId,
        ],
      )

      childIds.push(insertResult.rows[0].id)
    }

    return childIds
  }
}

/**
 * Roll up parent issue status when a child issue is completed.
 * If ALL children of a parent are 'done', sets the parent to 'done'.
 */
export async function rollUpParentStatus(
  db: DatabaseProvider,
  parentIssueId: string,
): Promise<boolean> {
  const childResult = await db.query<{ status: string }>(
    `SELECT status FROM issues WHERE parent_id = $1`,
    [parentIssueId],
  )

  // No children — nothing to roll up
  if (childResult.rows.length === 0) return false

  const allDone = childResult.rows.every(
    (row) => row.status === IssueStatus.Done,
  )

  if (allDone) {
    await db.query(
      `UPDATE issues SET status = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [IssueStatus.Done, parentIssueId],
    )
    return true
  }

  return false
}

export class DelegationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationError'
  }
}
