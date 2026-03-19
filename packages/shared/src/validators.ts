/**
 * @shackleai/shared — Zod validation schemas for create/update inputs
 */

import { z } from 'zod'
import {
  AgentStatus,
  IssueStatus,
  IssuePriority,
  AdapterType,
  TriggerType,
  PolicyAction,
  GoalLevel,
  HeartbeatRunStatus,
  CompanyStatus,
  AgentRole,
  GoalStatus,
  ProjectStatus,
  AgentApiKeyStatus,
  WorkProductType,
} from './constants.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uuid = z.string().uuid()
const nonEmpty = z.string().min(1)

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

const companyStatusValues = Object.values(CompanyStatus) as [
  string,
  ...string[],
]

export const CreateCompanyInput = z.object({
  name: nonEmpty,
  description: z.string().nullable().optional(),
  status: z
    .enum(companyStatusValues)
    .optional()
    .default(CompanyStatus.Active),
  issue_prefix: nonEmpty,
  budget_monthly_cents: z.number().int().min(0).optional().default(0),
  default_honesty_checklist: z.array(z.string().min(1)).nullable().optional(),
})
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>

export const UpdateCompanyInput = z.object({
  name: nonEmpty.optional(),
  description: z.string().nullable().optional(),
  status: z.enum(companyStatusValues).optional(),
  issue_prefix: nonEmpty.optional(),
  budget_monthly_cents: z.number().int().min(0).optional(),
  default_honesty_checklist: z.array(z.string().min(1)).nullable().optional(),
})
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const agentStatusValues = Object.values(AgentStatus) as [string, ...string[]]
const adapterTypeValues = Object.values(AdapterType) as [string, ...string[]]
const agentRoleValues = Object.values(AgentRole) as [string, ...string[]]

export const CreateAgentInput = z.object({
  company_id: uuid,
  name: nonEmpty,
  title: z.string().nullable().optional(),
  role: z.enum(agentRoleValues).optional().default(AgentRole.General),
  status: z.enum(agentStatusValues).optional().default(AgentStatus.Idle),
  reports_to: uuid.nullable().optional(),
  capabilities: z.string().nullable().optional(),
  adapter_type: z.enum(adapterTypeValues).default(AdapterType.Process),
  adapter_config: z.record(z.string(), z.unknown()).optional().default({}),
  budget_monthly_cents: z.number().int().min(0).optional().default(0),
})
export type CreateAgentInput = z.infer<typeof CreateAgentInput>

export const UpdateAgentInput = z.object({
  name: nonEmpty.optional(),
  title: z.string().nullable().optional(),
  role: z.enum(agentRoleValues).optional(),
  status: z.enum(agentStatusValues).optional(),
  reports_to: uuid.nullable().optional(),
  capabilities: z.string().nullable().optional(),
  adapter_type: z.enum(adapterTypeValues).optional(),
  adapter_config: z.record(z.string(), z.unknown()).optional(),
  budget_monthly_cents: z.number().int().min(0).optional(),
})
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

const issueStatusValues = Object.values(IssueStatus) as [string, ...string[]]
const issuePriorityValues = Object.values(IssuePriority) as [
  string,
  ...string[],
]

/** A single item in an honesty checklist — label + checked state. */
export const HonestyChecklistItemSchema = z.object({
  label: nonEmpty,
  checked: z.boolean().default(false),
})

export const CreateIssueInput = z.object({
  company_id: uuid,
  title: nonEmpty,
  description: z.string().nullable().optional(),
  parent_id: uuid.nullable().optional(),
  goal_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  status: z.enum(issueStatusValues).optional().default(IssueStatus.Backlog),
  priority: z
    .enum(issuePriorityValues)
    .optional()
    .default(IssuePriority.Medium),
  assignee_agent_id: uuid.nullable().optional(),
  honesty_checklist: z.array(HonestyChecklistItemSchema).nullable().optional(),
})
export type CreateIssueInput = z.infer<typeof CreateIssueInput>

export const UpdateIssueInput = z.object({
  title: nonEmpty.optional(),
  description: z.string().nullable().optional(),
  parent_id: uuid.nullable().optional(),
  goal_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  status: z.enum(issueStatusValues).optional(),
  priority: z.enum(issuePriorityValues).optional(),
  assignee_agent_id: uuid.nullable().optional(),
  honesty_checklist: z.array(HonestyChecklistItemSchema).nullable().optional(),
})
export type UpdateIssueInput = z.infer<typeof UpdateIssueInput>

export const DelegateIssueInput = z.object({
  from_agent_id: uuid,
  to_agent_id: uuid,
  sub_tasks: z
    .array(
      z.object({
        title: nonEmpty,
        description: z.string().nullable().optional(),
      }),
    )
    .min(1),
})
export type DelegateIssueInput = z.infer<typeof DelegateIssueInput>

/** Input for setting/updating an issue's honesty checklist. */
export const UpdateChecklistInput = z.object({
  items: z.array(HonestyChecklistItemSchema).min(1),
})
export type UpdateChecklistInput = z.infer<typeof UpdateChecklistInput>

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

const goalLevelValues = Object.values(GoalLevel) as [string, ...string[]]
const goalStatusValues = Object.values(GoalStatus) as [string, ...string[]]

export const CreateGoalInput = z.object({
  company_id: uuid,
  title: nonEmpty,
  description: z.string().nullable().optional(),
  parent_id: uuid.nullable().optional(),
  level: z.enum(goalLevelValues).default(GoalLevel.Task),
  status: z.enum(goalStatusValues).optional().default(GoalStatus.Active),
  owner_agent_id: uuid.nullable().optional(),
})
export type CreateGoalInput = z.infer<typeof CreateGoalInput>

export const UpdateGoalInput = z.object({
  title: nonEmpty.optional(),
  description: z.string().nullable().optional(),
  parent_id: uuid.nullable().optional(),
  level: z.enum(goalLevelValues).optional(),
  status: z.enum(goalStatusValues).optional(),
  owner_agent_id: uuid.nullable().optional(),
})
export type UpdateGoalInput = z.infer<typeof UpdateGoalInput>

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

const projectStatusValues = Object.values(ProjectStatus) as [
  string,
  ...string[],
]

export const CreateProjectInput = z.object({
  company_id: uuid,
  name: nonEmpty,
  description: z.string().nullable().optional(),
  goal_id: uuid.nullable().optional(),
  lead_agent_id: uuid.nullable().optional(),
  status: z
    .enum(projectStatusValues)
    .optional()
    .default(ProjectStatus.Active),
  target_date: z.string().nullable().optional(),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInput>

export const UpdateProjectInput = z.object({
  name: nonEmpty.optional(),
  description: z.string().nullable().optional(),
  goal_id: uuid.nullable().optional(),
  lead_agent_id: uuid.nullable().optional(),
  status: z.enum(projectStatusValues).optional(),
  target_date: z.string().nullable().optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>

// ---------------------------------------------------------------------------
// IssueComment
// ---------------------------------------------------------------------------

export const CreateIssueCommentInput = z.object({
  issue_id: uuid,
  content: nonEmpty,
  author_agent_id: uuid.nullable().optional(),
  parent_id: uuid.nullable().optional(),
  is_resolved: z.boolean().optional().default(false),
})
export type CreateIssueCommentInput = z.infer<typeof CreateIssueCommentInput>

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const policyActionValues = Object.values(PolicyAction) as [string, ...string[]]

export const CreatePolicyInput = z.object({
  company_id: uuid,
  agent_id: uuid.nullable().optional(),
  name: nonEmpty,
  tool_pattern: nonEmpty,
  action: z.enum(policyActionValues).default(PolicyAction.Allow),
  priority: z.number().int().min(0).default(0),
  max_calls_per_hour: z.number().int().min(0).nullable().optional(),
})
export type CreatePolicyInput = z.infer<typeof CreatePolicyInput>

export const UpdatePolicyInput = z.object({
  agent_id: uuid.nullable().optional(),
  name: nonEmpty.optional(),
  tool_pattern: nonEmpty.optional(),
  action: z.enum(policyActionValues).optional(),
  priority: z.number().int().min(0).optional(),
  max_calls_per_hour: z.number().int().min(0).nullable().optional(),
})
export type UpdatePolicyInput = z.infer<typeof UpdatePolicyInput>

// ---------------------------------------------------------------------------
// CostEvent
// ---------------------------------------------------------------------------

export const CreateCostEventInput = z.object({
  company_id: uuid,
  agent_id: uuid.nullable().optional(),
  issue_id: uuid.nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  /** Cost in cents — may be fractional (e.g. 0.35 cents for a cheap model call). */
  cost_cents: z.number().min(0),
})
export type CreateCostEventInput = z.infer<typeof CreateCostEventInput>

// ---------------------------------------------------------------------------
// HeartbeatRun
// ---------------------------------------------------------------------------

const triggerTypeValues = Object.values(TriggerType) as [string, ...string[]]
const heartbeatRunStatusValues = Object.values(HeartbeatRunStatus) as [
  string,
  ...string[],
]

export const CreateHeartbeatRunInput = z.object({
  company_id: uuid,
  agent_id: uuid,
  trigger_type: z.enum(triggerTypeValues),
  status: z
    .enum(heartbeatRunStatusValues)
    .optional()
    .default(HeartbeatRunStatus.Queued),
})
export type CreateHeartbeatRunInput = z.infer<typeof CreateHeartbeatRunInput>

export const UpdateHeartbeatRunInput = z.object({
  status: z.enum(heartbeatRunStatusValues).optional(),
  started_at: z.coerce.date().nullable().optional(),
  finished_at: z.coerce.date().nullable().optional(),
  exit_code: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  usage_json: z.record(z.string(), z.unknown()).nullable().optional(),
  session_id_before: z.string().nullable().optional(),
  session_id_after: z.string().nullable().optional(),
  stdout_excerpt: z.string().nullable().optional(),
})
export type UpdateHeartbeatRunInput = z.infer<typeof UpdateHeartbeatRunInput>

// ---------------------------------------------------------------------------
// AgentApiKey
// ---------------------------------------------------------------------------

const agentApiKeyStatusValues = Object.values(AgentApiKeyStatus) as [
  string,
  ...string[],
]

export const CreateAgentApiKeyInput = z.object({
  agent_id: uuid,
  company_id: uuid,
  key_hash: nonEmpty,
  label: z.string().nullable().optional(),
  status: z
    .enum(agentApiKeyStatusValues)
    .optional()
    .default(AgentApiKeyStatus.Active),
})
export type CreateAgentApiKeyInput = z.infer<typeof CreateAgentApiKeyInput>

// ---------------------------------------------------------------------------
// AgentWorktree
// ---------------------------------------------------------------------------

export const CreateWorktreeInput = z.object({
  agent_id: uuid,
  company_id: uuid,
  repo_path: nonEmpty,
  branch: nonEmpty,
  base_branch: nonEmpty.optional().default('main'),
  issue_id: uuid.nullable().optional(),
})
export type CreateWorktreeInput = z.infer<typeof CreateWorktreeInput>

export const WorktreeCleanupInput = z.object({
  dry_run: z.boolean().optional().default(false),
  max_age_ms: z.number().int().min(0).optional(),
})
export type WorktreeCleanupInput = z.infer<typeof WorktreeCleanupInput>


// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

export const CreateSecretInput = z.object({
  name: nonEmpty.regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Secret name must be a valid env-var style identifier (letters, digits, underscores)',
  ),
  value: nonEmpty,
  created_by: z.string().optional(),
})
export type CreateSecretInput = z.infer<typeof CreateSecretInput>

// ---------------------------------------------------------------------------
// QuotaWindow
// ---------------------------------------------------------------------------

const windowDurationValues = ['1m', '5m', '15m', '1h', '6h', '1d'] as const

export const CreateQuotaWindowInput = z.object({
  company_id: uuid,
  agent_id: uuid.nullable().optional(),
  provider: z.string().nullable().optional(),
  window_duration: z.enum(windowDurationValues).default('1h'),
  max_requests: z.number().int().min(1).nullable().optional(),
  max_tokens: z.number().int().min(1).nullable().optional(),
})
export type CreateQuotaWindowInput = z.infer<typeof CreateQuotaWindowInput>

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

/** Valid CSS hex color (3 or 6 digit). */
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color (e.g. #ff0000)')

export const CreateLabelInput = z.object({
  name: nonEmpty,
  color: hexColor.optional().default('#6b7280'),
  description: z.string().nullable().optional(),
})
export type CreateLabelInput = z.infer<typeof CreateLabelInput>

export const UpdateLabelInput = z.object({
  name: nonEmpty.optional(),
  color: hexColor.optional(),
  description: z.string().nullable().optional(),
})
export type UpdateLabelInput = z.infer<typeof UpdateLabelInput>

export const AssignLabelInput = z.object({
  label_id: uuid,
})
export type AssignLabelInput = z.infer<typeof AssignLabelInput>

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const CreateDocumentInput = z.object({
  title: nonEmpty,
  content: z.string().optional().default(''),
  created_by_agent_id: uuid.nullable().optional(),
})
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>

export const UpdateDocumentInput = z.object({
  title: nonEmpty.optional(),
  content: z.string().optional(),
  updated_by_agent_id: uuid.nullable().optional(),
})
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>

export const LinkDocumentInput = z.object({
  document_id: uuid,
})
export type LinkDocumentInput = z.infer<typeof LinkDocumentInput>

// ---------------------------------------------------------------------------
// Company Template
// ---------------------------------------------------------------------------

const templateAgentSchema = z.object({
  name: nonEmpty,
  title: z.string().nullable().optional(),
  role: z.enum(agentRoleValues).default(AgentRole.General),
  capabilities: z.string().nullable().optional(),
  adapter_type: z.enum(adapterTypeValues).default(AdapterType.Process),
  adapter_config: z.record(z.string(), z.unknown()).optional().default({}),
  budget_monthly_cents: z.number().int().min(0).optional().default(0),
  reports_to: z.string().nullable().optional(),
})

const templateGoalSchema = z.object({
  title: nonEmpty,
  description: z.string().nullable().optional(),
  level: z.enum(goalLevelValues).default(GoalLevel.Task),
  owner_agent_name: z.string().nullable().optional(),
})

const templatePolicySchema = z.object({
  name: nonEmpty,
  tool_pattern: nonEmpty,
  action: z.enum(policyActionValues).default(PolicyAction.Allow),
  priority: z.number().int().min(0).default(0),
  max_calls_per_hour: z.number().int().min(0).nullable().optional(),
  agent_name: z.string().nullable().optional(),
})

export const CompanyTemplateInput = z.object({
  name: nonEmpty,
  description: z.string().default(''),
  version: z.string().default('1.0.0'),
  agents: z.array(templateAgentSchema).min(1),
  goals: z.array(templateGoalSchema).optional().default([]),
  policies: z.array(templatePolicySchema).optional().default([]),
})
export type CompanyTemplateInput = z.infer<typeof CompanyTemplateInput>

// ---------------------------------------------------------------------------
// Company Export/Import
// ---------------------------------------------------------------------------

const exportProjectSchema = z.object({
  name: nonEmpty,
  description: z.string().nullable().optional(),
  status: z.enum(projectStatusValues).default(ProjectStatus.Active),
  target_date: z.string().nullable().optional(),
  goal_title: z.string().nullable().optional(),
  lead_agent_name: z.string().nullable().optional(),
})

const exportIssueSchema = z.object({
  title: nonEmpty,
  description: z.string().nullable().optional(),
  status: z.enum(issueStatusValues).default(IssueStatus.Backlog),
  priority: z.enum(issuePriorityValues).default(IssuePriority.Medium),
  assignee_agent_name: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  goal_title: z.string().nullable().optional(),
  parent_issue_title: z.string().nullable().optional(),
})

const exportCompanyMetaSchema = z.object({
  name: nonEmpty,
  description: z.string().nullable().optional(),
  issue_prefix: nonEmpty,
  budget_monthly_cents: z.number().int().min(0).optional().default(0),
  default_honesty_checklist: z.array(z.string().min(1)).nullable().optional(),
  require_approval: z.boolean().optional().default(false),
})

export const CompanyExportInput = z.object({
  export_version: z.string().default("1.0.0"),
  name: nonEmpty,
  description: z.string().default(""),
  version: z.string().default("1.0.0"),
  company: exportCompanyMetaSchema,
  agents: z.array(templateAgentSchema).min(1),
  goals: z.array(templateGoalSchema).optional().default([]),
  policies: z.array(templatePolicySchema).optional().default([]),
  projects: z.array(exportProjectSchema).optional().default([]),
  issues: z.array(exportIssueSchema).optional().default([]),
})
export type CompanyExportInput = z.infer<typeof CompanyExportInput>


// ---------------------------------------------------------------------------
// Work Products
// ---------------------------------------------------------------------------

const workProductTypeValues = Object.values(WorkProductType) as [
  string,
  ...string[],
]

export const CreateWorkProductInput = z.object({
  issue_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(workProductTypeValues),
  url: z.string().min(1),
  agent_id: z.string().uuid().nullable().optional(),
})
export type CreateWorkProductInput = z.infer<typeof CreateWorkProductInput>
