/**
 * ContextBuilder — generates structured system context for agent heartbeats.
 *
 * Builds a Markdown document that teaches an agent about its identity, team,
 * tasks, governance policies, and how to report results back to the orchestrator.
 * This context is injected into every heartbeat prompt so agents can interact
 * with the ShackleAI API without being pre-trained.
 *
 * Read-only — only SELECT queries. No mutations.
 */

import type { DatabaseProvider } from '@shackleai/db'

interface AgentRow {
  id: string
  name: string
  role: string | null
  title: string | null
  capabilities: string | null
  status: string
}

interface CompanyRow {
  name: string
  description: string | null
}

interface TeamMemberRow {
  name: string
  role: string | null
  status: string
}

interface TaskRow {
  identifier: string | null
  title: string
  status: string
  priority: string | null
}

interface PolicyRow {
  tool_pattern: string
  action: string
}

interface ReportRow {
  name: string
  role: string | null
}

export class ContextBuilder {
  constructor(private db: DatabaseProvider) {}

  /**
   * Build a structured context string for an agent's heartbeat.
   * Includes: role, team, tasks, policies, company info, API reference.
   */
  async build(agentId: string, companyId: string): Promise<string> {
    const [agent, company, team, tasks, policies, reports] = await Promise.all([
      this.getAgent(agentId),
      this.getCompany(companyId),
      this.getTeamMembers(agentId, companyId),
      this.getActiveTasks(agentId),
      this.getPolicies(companyId),
      this.getDirectReports(agentId),
    ])

    const sections: string[] = ['# ShackleAI Agent Context']

    // Identity
    sections.push(this.buildIdentitySection(agent, company))

    // Team
    sections.push(this.buildTeamSection(team))

    // Direct Reports
    sections.push(this.buildReportsSection(reports))

    // Active Tasks
    sections.push(this.buildTasksSection(tasks))

    // Governance Policies
    sections.push(this.buildPoliciesSection(policies))

    // API Reference — reporting results
    sections.push(this.buildApiReferenceSection())

    return sections.join('\n\n')
  }

  // ── Data fetchers (read-only) ────────────────────────────────────────

  private async getAgent(agentId: string): Promise<AgentRow | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT id, name, role, title, capabilities, status
       FROM agents WHERE id = $1`,
      [agentId],
    )
    return result.rows[0] ?? null
  }

  private async getCompany(companyId: string): Promise<CompanyRow | null> {
    const result = await this.db.query<CompanyRow>(
      `SELECT name, description FROM companies WHERE id = $1`,
      [companyId],
    )
    return result.rows[0] ?? null
  }

  private async getTeamMembers(
    agentId: string,
    companyId: string,
  ): Promise<TeamMemberRow[]> {
    const result = await this.db.query<TeamMemberRow>(
      `SELECT name, role, status FROM agents
       WHERE company_id = $1 AND id != $2
       ORDER BY name`,
      [companyId, agentId],
    )
    return result.rows
  }

  private async getActiveTasks(agentId: string): Promise<TaskRow[]> {
    const result = await this.db.query<TaskRow>(
      `SELECT identifier, title, status, priority FROM issues
       WHERE assignee_agent_id = $1
         AND status NOT IN ('done', 'cancelled')
       ORDER BY priority, created_at`,
      [agentId],
    )
    return result.rows
  }

  private async getPolicies(companyId: string): Promise<PolicyRow[]> {
    const result = await this.db.query<PolicyRow>(
      `SELECT tool_pattern, action FROM policies
       WHERE company_id = $1
       ORDER BY tool_pattern, action`,
      [companyId],
    )
    return result.rows
  }

  private async getDirectReports(agentId: string): Promise<ReportRow[]> {
    const result = await this.db.query<ReportRow>(
      `SELECT name, role FROM agents WHERE reports_to = $1 ORDER BY name`,
      [agentId],
    )
    return result.rows
  }

  // ── Section builders ─────────────────────────────────────────────────

  private buildIdentitySection(
    agent: AgentRow | null,
    company: CompanyRow | null,
  ): string {
    const lines = ['## Your Identity']
    lines.push(`- Name: ${agent?.name ?? 'Unknown'}`)
    lines.push(`- Role: ${agent?.role ?? 'agent'}`)
    if (agent?.title) lines.push(`- Title: ${agent.title}`)
    lines.push(`- Company: ${company?.name ?? 'Unknown'}`)
    if (company?.description) lines.push(`- Mission: ${company.description}`)
    return lines.join('\n')
  }

  private buildTeamSection(team: TeamMemberRow[]): string {
    if (team.length === 0) {
      return '## Your Team\n\nNo team members.'
    }

    const lines = ['## Your Team', '', '| Name | Role | Status |', '|------|------|--------|']
    for (const m of team) {
      lines.push(`| ${m.name} | ${m.role ?? 'agent'} | ${m.status} |`)
    }
    return lines.join('\n')
  }

  private buildReportsSection(reports: ReportRow[]): string {
    if (reports.length === 0) {
      return '## Your Direct Reports\n\nNo direct reports.'
    }

    const lines = ['## Your Direct Reports']
    for (const r of reports) {
      lines.push(`- ${r.name} (${r.role ?? 'agent'})`)
    }
    return lines.join('\n')
  }

  private buildTasksSection(tasks: TaskRow[]): string {
    if (tasks.length === 0) {
      return '## Active Tasks\n\nNo active tasks.'
    }

    const lines = ['## Active Tasks']
    for (const t of tasks) {
      const id = t.identifier ?? 'N/A'
      const priority = t.priority ?? 'medium'
      lines.push(`- ${id}: ${t.title} [${t.status}, ${priority}]`)
    }
    return lines.join('\n')
  }

  private buildPoliciesSection(policies: PolicyRow[]): string {
    if (policies.length === 0) {
      return '## Governance Policies\n\nNo policies configured.'
    }

    const lines = ['## Governance Policies']
    for (const p of policies) {
      lines.push(`- ${p.tool_pattern}: ${p.action}`)
    }
    return lines.join('\n')
  }

  private buildApiReferenceSection(): string {
    return [
      '## Reporting Results',
      '',
      'To report tool usage and session state, include in your output:',
      '```',
      '__shackleai_result__{"sessionState":"...","usage":{"inputTokens":N,"outputTokens":N,"costCents":N,"model":"...","provider":"..."}}__shackleai_result__',
      '```',
    ].join('\n')
  }
}
