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
})
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>

export const UpdateCompanyInput = z.object({
  name: nonEmpty.optional(),
  description: z.string().nullable().optional(),
  status: z.enum(companyStatusValues).optional(),
  issue_prefix: nonEmpty.optional(),
  budget_monthly_cents: z.number().int().min(0).optional(),
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
})
export type UpdateIssueInput = z.infer<typeof UpdateIssueInput>

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
  cost_cents: z.number().int().min(0),
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
