/**
 * Company templates — built-in and custom org structure templates
 *
 * Templates are portable, ID-free descriptions of a company's agent hierarchy,
 * goals, and policies. When imported, the template creates all entities and
 * resolves name-based references to real IDs.
 */

import type { DatabaseProvider } from '@shackleai/db'
import type {
  CompanyTemplate,
  TemplateSummary,
  Agent,
  Goal,
  Policy,
} from '@shackleai/shared'
import { BUILTIN_TEMPLATES } from './builtin.js'

/** List all available built-in templates as summaries. */
export function listTemplates(): TemplateSummary[] {
  const summaries: TemplateSummary[] = []

  for (const [slug, template] of Object.entries(BUILTIN_TEMPLATES)) {
    summaries.push({
      slug,
      name: template.name,
      description: template.description,
      version: template.version,
      agent_count: template.agents.length,
      goal_count: template.goals?.length ?? 0,
      policy_count: template.policies?.length ?? 0,
    })
  }

  return summaries
}

/** Get a specific built-in template by slug. */
export function getTemplate(slug: string): CompanyTemplate | null {
  return BUILTIN_TEMPLATES[slug] ?? null
}

/** Result of importing a template into a company. */
export interface TemplateImportResult {
  agents_created: number
  goals_created: number
  policies_created: number
  agents: Agent[]
  goals: Goal[]
  policies: Policy[]
}

/**
 * Import a template into an existing company, creating all agents, goals, and policies.
 * Name-based references (reports_to, owner_agent_name, agent_name) are resolved to real IDs.
 */
export async function importTemplate(
  db: DatabaseProvider,
  companyId: string,
  template: CompanyTemplate,
): Promise<TemplateImportResult> {
  // Phase 1: Create all agents (without reports_to -- we resolve it in phase 2)
  const agentNameToId = new Map<string, string>()
  const createdAgents: Agent[] = []

  for (const ta of template.agents) {
    const result = await db.query<Agent>(
      `INSERT INTO agents
         (company_id, name, title, role, capabilities, adapter_type, adapter_config, budget_monthly_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        companyId,
        ta.name,
        ta.title ?? null,
        ta.role,
        ta.capabilities ?? null,
        ta.adapter_type,
        JSON.stringify(ta.adapter_config ?? {}),
        ta.budget_monthly_cents ?? 0,
      ],
    )

    const agent = result.rows[0]
    agentNameToId.set(ta.name, agent.id)
    createdAgents.push(agent)
  }

  // Phase 2: Resolve reports_to references
  for (const ta of template.agents) {
    if (ta.reports_to) {
      const reportsToId = agentNameToId.get(ta.reports_to)
      const agentId = agentNameToId.get(ta.name)
      if (reportsToId && agentId) {
        await db.query(
          `UPDATE agents SET reports_to = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [reportsToId, agentId, companyId],
        )
        const idx = createdAgents.findIndex((a) => a.id === agentId)
        if (idx !== -1) {
          createdAgents[idx] = { ...createdAgents[idx], reports_to: reportsToId }
        }
      }
    }
  }

  // Phase 3: Create goals
  const createdGoals: Goal[] = []
  for (const tg of template.goals ?? []) {
    const ownerAgentId = tg.owner_agent_name
      ? agentNameToId.get(tg.owner_agent_name) ?? null
      : null

    const result = await db.query<Goal>(
      `INSERT INTO goals (company_id, title, description, level, owner_agent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, tg.title, tg.description ?? null, tg.level, ownerAgentId],
    )
    createdGoals.push(result.rows[0])
  }

  // Phase 4: Create policies
  const createdPolicies: Policy[] = []
  for (const tp of template.policies ?? []) {
    const agentId = tp.agent_name
      ? agentNameToId.get(tp.agent_name) ?? null
      : null

    const result = await db.query<Policy>(
      `INSERT INTO policies
         (company_id, agent_id, name, tool_pattern, action, priority, max_calls_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        agentId,
        tp.name,
        tp.tool_pattern,
        tp.action,
        tp.priority ?? 0,
        tp.max_calls_per_hour ?? null,
      ],
    )
    createdPolicies.push(result.rows[0])
  }

  return {
    agents_created: createdAgents.length,
    goals_created: createdGoals.length,
    policies_created: createdPolicies.length,
    agents: createdAgents,
    goals: createdGoals,
    policies: createdPolicies,
  }
}

/**
 * Export a company's current agents, goals, and policies as a template.
 * All IDs are scrubbed -- references use names instead.
 */
export async function exportTemplate(
  db: DatabaseProvider,
  companyId: string,
  templateName: string,
  templateDescription?: string,
): Promise<CompanyTemplate> {
  const agentResult = await db.query<Agent>(
    `SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  )
  const agents = agentResult.rows

  const agentIdToName = new Map<string, string>()
  for (const a of agents) {
    agentIdToName.set(a.id, a.name)
  }

  const goalResult = await db.query<Goal>(
    `SELECT * FROM goals WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  )

  const policyResult = await db.query<Policy>(
    `SELECT * FROM policies WHERE company_id = $1 ORDER BY priority DESC, created_at ASC`,
    [companyId],
  )

  return {
    name: templateName,
    description: templateDescription ?? '',
    version: '1.0.0',
    agents: agents.map((a) => ({
      name: a.name,
      title: a.title,
      role: a.role,
      capabilities: a.capabilities,
      adapter_type: a.adapter_type,
      adapter_config: a.adapter_config,
      budget_monthly_cents: a.budget_monthly_cents,
      reports_to: a.reports_to ? agentIdToName.get(a.reports_to) ?? null : null,
    })),
    goals: goalResult.rows.map((g) => ({
      title: g.title,
      description: g.description,
      level: g.level,
      owner_agent_name: g.owner_agent_id
        ? agentIdToName.get(g.owner_agent_id) ?? null
        : null,
    })),
    policies: policyResult.rows.map((p) => ({
      name: p.name,
      tool_pattern: p.tool_pattern,
      action: p.action,
      priority: p.priority,
      max_calls_per_hour: p.max_calls_per_hour,
      agent_name: p.agent_id ? agentIdToName.get(p.agent_id) ?? null : null,
    })),
  }
}

/** No-op -- kept for API compatibility. Templates are now inlined. */
export function clearTemplateCache(): void {
  // Templates are inlined, no cache to clear
}
