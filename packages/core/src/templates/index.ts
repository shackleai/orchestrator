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
  CompanyExport,
  CompanyImportResult,
  TemplateSummary,
  Company,
  Agent,
  Goal,
  Policy,
  Project,
  Issue,
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

/**
 * Export a full company snapshot -- agents, goals, policies, projects, and issues.
 * All UUIDs are scrubbed and replaced with name-based references.
 * Secrets, cost_events, heartbeat_runs, and timestamps are stripped.
 */
export async function exportCompany(
  db: DatabaseProvider,
  companyId: string,
): Promise<CompanyExport> {
  // Fetch company metadata
  const companyResult = await db.query<Company>(
    `SELECT * FROM companies WHERE id = $1`,
    [companyId],
  )
  if (companyResult.rows.length === 0) {
    throw new Error(`Company ${companyId} not found`)
  }
  const company = companyResult.rows[0]

  // Fetch all entities
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
  const goals = goalResult.rows

  const goalIdToTitle = new Map<string, string>()
  for (const g of goals) {
    goalIdToTitle.set(g.id, g.title)
  }

  const policyResult = await db.query<Policy>(
    `SELECT * FROM policies WHERE company_id = $1 ORDER BY priority DESC, created_at ASC`,
    [companyId],
  )

  const projectResult = await db.query<Project>(
    `SELECT * FROM projects WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  )
  const projects = projectResult.rows

  const projectIdToName = new Map<string, string>()
  for (const pr of projects) {
    projectIdToName.set(pr.id, pr.name)
  }

  const issueResult = await db.query<Issue>(
    `SELECT * FROM issues WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  )
  const issues = issueResult.rows

  const issueIdToTitle = new Map<string, string>()
  for (const i of issues) {
    issueIdToTitle.set(i.id, i.title)
  }

  return {
    export_version: '1.0.0',
    name: company.name,
    description: company.description ?? '',
    version: '1.0.0',
    company: {
      name: company.name,
      description: company.description,
      issue_prefix: company.issue_prefix,
      budget_monthly_cents: company.budget_monthly_cents,
      default_honesty_checklist: company.default_honesty_checklist,
      require_approval: company.require_approval,
    },
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
    goals: goals.map((g) => ({
      title: g.title,
      description: g.description,
      level: g.level,
      owner_agent_name: g.owner_agent_id
        ? agentIdToName.get(g.owner_agent_id) ?? null
        : null,
    })),
    policies: policyResult.rows.map((po) => ({
      name: po.name,
      tool_pattern: po.tool_pattern,
      action: po.action,
      priority: po.priority,
      max_calls_per_hour: po.max_calls_per_hour,
      agent_name: po.agent_id ? agentIdToName.get(po.agent_id) ?? null : null,
    })),
    projects: projects.map((pr) => ({
      name: pr.name,
      description: pr.description,
      status: pr.status,
      target_date: pr.target_date,
      goal_title: pr.goal_id ? goalIdToTitle.get(pr.goal_id) ?? null : null,
      lead_agent_name: pr.lead_agent_id
        ? agentIdToName.get(pr.lead_agent_id) ?? null
        : null,
    })),
    issues: issues.map((i) => ({
      title: i.title,
      description: i.description,
      status: i.status,
      priority: i.priority,
      assignee_agent_name: i.assignee_agent_id
        ? agentIdToName.get(i.assignee_agent_id) ?? null
        : null,
      project_name: i.project_id
        ? projectIdToName.get(i.project_id) ?? null
        : null,
      goal_title: i.goal_id ? goalIdToTitle.get(i.goal_id) ?? null : null,
      parent_issue_title: i.parent_id
        ? issueIdToTitle.get(i.parent_id) ?? null
        : null,
    })),
  }
}

/**
 * Import a full company export -- creates company + all entities.
 * Resolves all name-based references to real IDs.
 * If a company with the same name exists, the caller must provide a renamed company.name.
 */
export async function importCompany(
  db: DatabaseProvider,
  data: CompanyExport,
): Promise<CompanyImportResult> {
  // Check for name collision
  const existing = await db.query<Company>(
    `SELECT id FROM companies WHERE name = $1`,
    [data.company.name],
  )
  if (existing.rows.length > 0) {
    throw new Error(
      `A company named "${data.company.name}" already exists. Choose a different name.`,
    )
  }

  // Phase 1: Create the company
  const companyResult = await db.query<Company>(
    `INSERT INTO companies
       (name, description, issue_prefix, budget_monthly_cents, default_honesty_checklist, require_approval)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.company.name,
      data.company.description ?? null,
      data.company.issue_prefix,
      data.company.budget_monthly_cents ?? 0,
      data.company.default_honesty_checklist
        ? JSON.stringify(data.company.default_honesty_checklist)
        : null,
      data.company.require_approval ?? false,
    ],
  )
  const company = companyResult.rows[0]
  const companyId = company.id

  // Phase 2: Import agents, goals, policies via existing importTemplate
  const templateResult = await importTemplate(db, companyId, {
    name: data.name,
    description: data.description,
    version: data.version,
    agents: data.agents,
    goals: data.goals,
    policies: data.policies,
  })

  // Build lookup maps from created entities
  const agentNameToId = new Map<string, string>()
  for (const a of templateResult.agents) {
    agentNameToId.set(a.name, a.id)
  }

  const goalTitleToId = new Map<string, string>()
  for (const g of templateResult.goals) {
    goalTitleToId.set(g.title, g.id)
  }

  // Phase 3: Create projects
  const projectNameToId = new Map<string, string>()
  let projectsCreated = 0

  for (const ep of data.projects ?? []) {
    const goalId = ep.goal_title
      ? goalTitleToId.get(ep.goal_title) ?? null
      : null
    const leadAgentId = ep.lead_agent_name
      ? agentNameToId.get(ep.lead_agent_name) ?? null
      : null

    const result = await db.query<Project>(
      `INSERT INTO projects
         (company_id, name, description, status, target_date, goal_id, lead_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        ep.name,
        ep.description ?? null,
        ep.status,
        ep.target_date ?? null,
        goalId,
        leadAgentId,
      ],
    )
    projectNameToId.set(ep.name, result.rows[0].id)
    projectsCreated++
  }

  // Phase 4: Create issues (two passes -- first without parent_id, then resolve parents)
  const issueTitleToId = new Map<string, string>()
  let issuesCreated = 0

  // First pass: create all issues without parent references
  for (const ei of data.issues ?? []) {
    const assigneeId = ei.assignee_agent_name
      ? agentNameToId.get(ei.assignee_agent_name) ?? null
      : null
    const projectId = ei.project_name
      ? projectNameToId.get(ei.project_name) ?? null
      : null
    const goalId = ei.goal_title
      ? goalTitleToId.get(ei.goal_title) ?? null
      : null

    const result = await db.query<Issue>(
      `INSERT INTO issues
         (company_id, title, description, status, priority, assignee_agent_id, project_id, goal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        companyId,
        ei.title,
        ei.description ?? null,
        ei.status,
        ei.priority,
        assigneeId,
        projectId,
        goalId,
      ],
    )
    issueTitleToId.set(ei.title, result.rows[0].id)
    issuesCreated++
  }

  // Second pass: resolve parent issue references
  for (const ei of data.issues ?? []) {
    if (ei.parent_issue_title) {
      const parentId = issueTitleToId.get(ei.parent_issue_title)
      const issueId = issueTitleToId.get(ei.title)
      if (parentId && issueId) {
        await db.query(
          `UPDATE issues SET parent_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
          [parentId, issueId, companyId],
        )
      }
    }
  }

  return {
    company,
    agents_created: templateResult.agents_created,
    goals_created: templateResult.goals_created,
    policies_created: templateResult.policies_created,
    projects_created: projectsCreated,
    issues_created: issuesCreated,
  }
}

/** No-op -- kept for API compatibility. Templates are now inlined. */
export function clearTemplateCache(): void {
  // Templates are inlined, no cache to clear
}
