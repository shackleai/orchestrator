/**
 * GovernanceEngine — Policy evaluation engine for tool-level access control.
 *
 * Security model: **default-deny**. If no matching policy exists for a given
 * (companyId, agentId, toolName) tuple, access is denied. This prevents
 * privilege escalation via unconfigured tools.
 *
 * Policy resolution order:
 * 1. Fetch all policies for the company (agent-specific + company-wide)
 * 2. Sort by priority DESC
 * 3. At equal priority, agent-specific policies take precedence over company-wide
 * 4. Match tool_pattern using glob (micromatch)
 * 5. Return the first matching policy's action
 */

import type { DatabaseProvider } from '@shackleai/db'
import type { Policy } from '@shackleai/shared'
import { PolicyAction } from '@shackleai/shared'
import micromatch from 'micromatch'

export interface PolicyCheckResult {
  allowed: boolean
  policyId?: string
  reason?: string
}

export class GovernanceEngine {
  private readonly db: DatabaseProvider

  constructor(db: DatabaseProvider) {
    this.db = db
  }

  /**
   * Evaluate governance policies for a tool invocation.
   *
   * @param companyId — UUID of the company
   * @param agentId   — UUID of the agent requesting access
   * @param toolName  — Fully qualified tool name (e.g. "github:list_issues")
   * @param _params   — Optional tool parameters (reserved for future condition matching)
   * @returns PolicyCheckResult with allowed flag, matching policy ID, and reason
   */
  async checkPolicy(
    companyId: string,
    agentId: string,
    toolName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _params?: Record<string, unknown>,
  ): Promise<PolicyCheckResult> {
    // Fetch all policies for this company that apply to this agent
    // (agent-specific OR company-wide where agent_id IS NULL)
    const result = await this.db.query<Policy>(
      `SELECT id, company_id, agent_id, name, tool_pattern, action, priority, max_calls_per_hour, created_at
       FROM policies
       WHERE company_id = $1
         AND (agent_id = $2 OR agent_id IS NULL)
       ORDER BY priority DESC`,
      [companyId, agentId],
    )

    const policies = result.rows

    // Sort: at equal priority, agent-specific policies come before company-wide
    policies.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority
      }
      // Agent-specific (non-null agent_id) takes precedence at same priority
      if (a.agent_id !== null && b.agent_id === null) return -1
      if (a.agent_id === null && b.agent_id !== null) return 1
      return 0
    })

    // Evaluate each policy in priority order — first match wins
    for (const policy of policies) {
      if (micromatch.isMatch(toolName, policy.tool_pattern)) {
        const action = policy.action as PolicyAction

        if (action === PolicyAction.Allow) {
          return {
            allowed: true,
            policyId: policy.id,
            reason: `Allowed by policy "${policy.name}" (${policy.tool_pattern})`,
          }
        }

        if (action === PolicyAction.Deny) {
          return {
            allowed: false,
            policyId: policy.id,
            reason: `Denied by policy "${policy.name}" (${policy.tool_pattern})`,
          }
        }

        if (action === PolicyAction.Log) {
          // Log action permits execution but flags it for audit
          return {
            allowed: true,
            policyId: policy.id,
            reason: `Allowed with logging by policy "${policy.name}" (${policy.tool_pattern})`,
          }
        }
      }
    }

    // Default-deny: no matching policy means access is denied
    return {
      allowed: false,
      reason: 'No matching policy found — default deny',
    }
  }
}
