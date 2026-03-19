/**
 * WorkspacePolicyEngine -- Enforces per-agent, per-workspace operation policies.
 *
 * Security model: **default-deny for cross-workspace access**.
 * An agent can only operate in workspaces it owns unless an explicit
 * allow rule grants cross-workspace access.
 *
 * Policy resolution:
 * 1. Check workspace ownership (agent_id match)
 * 2. Load workspace-specific rules ordered by priority DESC
 * 3. Match operation type and file path (glob via micromatch)
 * 4. First matching rule wins
 * 5. If no rule matches: ALLOW for own workspace, DENY for foreign workspace
 */

import type { DatabaseProvider } from '@shackleai/db'
import type {
  WorkspacePolicyRule,
  WorkspacePolicyCheckResult,
  WorkspaceOperationType,
} from '@shackleai/shared'
import { WorkspacePolicyAction } from '@shackleai/shared'
import micromatch from 'micromatch'

// ---------------------------------------------------------------------------
// WorkspacePolicyEngine
// ---------------------------------------------------------------------------

interface PolicyCheckInput {
  /** The agent requesting the operation. */
  agentId: string
  /** The workspace (worktree) the operation targets. */
  workspaceId: string
  /** The type of operation being performed. */
  operation: WorkspaceOperationType
  /** Optional file path for file-scoped operations. */
  filePath?: string
}

export class WorkspacePolicyEngine {
  private readonly db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  /**
   * Check whether an agent is allowed to perform an operation in a workspace.
   *
   * @returns PolicyCheckResult with allowed flag, matched rule, and reason
   */
  async checkPolicy(input: PolicyCheckInput): Promise<WorkspacePolicyCheckResult> {
    const { agentId, workspaceId, operation, filePath } = input

    // Step 1: Determine workspace ownership
    const isOwner = await this.isWorkspaceOwner(agentId, workspaceId)

    // Step 2: Load policy rules for this workspace + agent
    const rules = await this.loadRules(workspaceId, agentId)

    // Step 3: Evaluate rules in priority order (already sorted DESC)
    for (const rule of rules) {
      if (!this.matchesOperation(rule, operation)) continue
      if (!this.matchesFilePath(rule, filePath)) continue

      // Rule matched
      const allowed = rule.action === WorkspacePolicyAction.Allow
      return {
        allowed,
        matchedRule: rule,
        reason: allowed
          ? `Allowed by rule: operations=[${rule.operations.join(',')}], files=[${rule.filePatterns.join(',')}]`
          : `Denied by rule: operations=[${rule.operations.join(',')}], files=[${rule.filePatterns.join(',')}]`,
      }
    }

    // Step 4: No rule matched -- apply default policy
    if (isOwner) {
      return {
        allowed: true,
        reason: 'Default allow: agent owns this workspace',
      }
    }

    return {
      allowed: false,
      reason: 'Default deny: agent does not own this workspace and no allow rule matches',
    }
  }

  /**
   * Set policy rules for a workspace + agent combination.
   * Replaces all existing rules for this (workspaceId, agentId) pair.
   */
  async setRules(
    workspaceId: string,
    agentId: string,
    rules: WorkspacePolicyRule[],
  ): Promise<void> {
    // Delete existing rules
    await this.db.query(
      `DELETE FROM workspace_policy_rules
       WHERE workspace_id = $1 AND agent_id = $2`,
      [workspaceId, agentId],
    )

    // Insert new rules
    for (const rule of rules) {
      await this.db.query(
        `INSERT INTO workspace_policy_rules
           (workspace_id, agent_id, operations, file_patterns, action, priority)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workspaceId,
          agentId,
          JSON.stringify(rule.operations),
          JSON.stringify(rule.filePatterns),
          rule.action,
          rule.priority,
        ],
      )
    }
  }

  /**
   * Get all policy rules for a workspace + agent combination.
   */
  async getRules(
    workspaceId: string,
    agentId: string,
  ): Promise<WorkspacePolicyRule[]> {
    return this.loadRules(workspaceId, agentId)
  }

  /**
   * Remove all policy rules for a workspace + agent combination.
   */
  async clearRules(workspaceId: string, agentId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM workspace_policy_rules
       WHERE workspace_id = $1 AND agent_id = $2`,
      [workspaceId, agentId],
    )
  }

  // -- Private ------------------------------------------------------------

  private async isWorkspaceOwner(
    agentId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_worktrees
       WHERE id = $1 AND agent_id = $2`,
      [workspaceId, agentId],
    )
    return parseInt(result.rows[0]?.count ?? '0', 10) > 0
  }

  private async loadRules(
    workspaceId: string,
    agentId: string,
  ): Promise<WorkspacePolicyRule[]> {
    interface RuleRow {
      operations: string
      file_patterns: string
      action: string
      priority: number
    }

    const result = await this.db.query<RuleRow>(
      `SELECT operations, file_patterns, action, priority
       FROM workspace_policy_rules
       WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY priority DESC`,
      [workspaceId, agentId],
    )

    return result.rows.map((row) => ({
      operations: typeof row.operations === 'string'
        ? JSON.parse(row.operations) as string[]
        : row.operations as unknown as string[],
      filePatterns: typeof row.file_patterns === 'string'
        ? JSON.parse(row.file_patterns) as string[]
        : row.file_patterns as unknown as string[],
      action: row.action,
      priority: row.priority,
    }))
  }

  private matchesOperation(
    rule: WorkspacePolicyRule,
    operation: WorkspaceOperationType,
  ): boolean {
    // Empty operations array = matches all operations
    if (rule.operations.length === 0) return true
    return rule.operations.includes(operation)
  }

  private matchesFilePath(
    rule: WorkspacePolicyRule,
    filePath?: string,
  ): boolean {
    // Empty file patterns = matches all files
    if (rule.filePatterns.length === 0) return true
    // If rule has file patterns but no file path was provided, no match
    if (!filePath) return false
    return micromatch.isMatch(filePath, rule.filePatterns)
  }
}
