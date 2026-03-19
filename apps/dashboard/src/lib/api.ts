const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

interface ApiResponse<T> {
  data: T
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  return json.data
}

// --- Types ---

export interface Agent {
  id: string
  company_id: string
  name: string
  title: string | null
  role: string
  status: string
  reports_to: string | null
  capabilities: string | null
  adapter_type: string
  adapter_config: Record<string, unknown>
  budget_monthly_cents: number
  spent_monthly_cents: number
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

export interface Issue {
  id: string
  company_id: string
  identifier: string
  issue_number: number
  parent_id: string | null
  goal_id: string | null
  project_id: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assignee_agent_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface HeartbeatRun {
  id: string
  company_id: string
  agent_id: string
  trigger_type: string
  status: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  stdout_excerpt: string | null
  error: string | null
  usage_json: string | null
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  company_id: string
  entity_type: string
  entity_id: string | null
  actor_type: string
  actor_id: string | null
  action: string
  changes: Record<string, unknown> | null
  created_at: string
}

export interface DashboardData {
  agentCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  totalSpendCents: number
  recentActivity: ActivityLogEntry[]
}

export interface Comment {
  id: string
  issue_id: string
  content: string
  author_agent_id: string | null
  parent_id: string | null
  is_resolved: boolean
  created_at: string
}

// --- Fetchers ---

export function fetchDashboard(companyId: string) {
  return fetchJson<DashboardData>(`${BASE_URL}/companies/${companyId}/dashboard`)
}

export function fetchAgents(
  companyId: string,
  pagination?: { limit: number; offset: number },
) {
  const params = new URLSearchParams()
  if (pagination) {
    params.set('limit', String(pagination.limit))
    params.set('offset', String(pagination.offset))
  }
  const qs = params.toString()
  return fetchJson<Agent[]>(
    `${BASE_URL}/companies/${companyId}/agents${qs ? `?${qs}` : ''}`,
  )
}

export function fetchAgent(companyId: string, agentId: string) {
  return fetchJson<Agent>(`${BASE_URL}/companies/${companyId}/agents/${agentId}`)
}

export function fetchHeartbeats(
  companyId: string,
  agentId: string,
  pagination?: { limit: number; offset: number },
) {
  const params = new URLSearchParams()
  if (pagination) {
    params.set('limit', String(pagination.limit))
    params.set('offset', String(pagination.offset))
  }
  const qs = params.toString()
  return fetchJson<HeartbeatRun[]>(
    `${BASE_URL}/companies/${companyId}/agents/${agentId}/heartbeats${qs ? `?${qs}` : ''}`,
  )
}

export function fetchTasks(
  companyId: string,
  filters?: { status?: string; priority?: string },
  pagination?: { limit: number; offset: number },
) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.priority) params.set('priority', filters.priority)
  if (pagination) {
    params.set('limit', String(pagination.limit))
    params.set('offset', String(pagination.offset))
  }
  const qs = params.toString()
  return fetchJson<Issue[]>(
    `${BASE_URL}/companies/${companyId}/issues${qs ? `?${qs}` : ''}`,
  )
}

export function fetchActivity(
  companyId: string,
  filters?: { entity_type?: string; from?: string; to?: string },
  pagination?: { limit: number; offset: number },
) {
  const params = new URLSearchParams()
  if (filters?.entity_type) params.set('entity_type', filters.entity_type)
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  if (pagination) {
    params.set('limit', String(pagination.limit))
    params.set('offset', String(pagination.offset))
  }
  const qs = params.toString()
  return fetchJson<ActivityLogEntry[]>(
    `${BASE_URL}/companies/${companyId}/activity${qs ? `?${qs}` : ''}`,
  )
}

// --- Cost types ---

export interface CostEvent {
  id: string
  company_id: string
  agent_id: string | null
  issue_id: string | null
  provider: string | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cost_cents: number
  occurred_at: string
}

export interface CostByAgent {
  agent_id: string | null
  total_cost_cents: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
}

// --- Company & License types ---

export interface Company {
  id: string
  name: string
  description: string | null
  status: string
  budget_monthly_cents: number
  spent_monthly_cents: number
  created_at: string
  updated_at: string
}

export interface LicenseKey {
  id: string
  company_id: string
  tier: string
  valid_until: string | null
}

// --- Company list fetcher ---

export function fetchCompanies() {
  return fetchJson<Company[]>(`${BASE_URL}/companies`)
}

// --- Cost fetchers ---

export function fetchCostEvents(
  companyId: string,
  filters?: { from?: string; to?: string },
  pagination?: { limit: number; offset: number },
) {
  const params = new URLSearchParams()
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  if (pagination) {
    params.set('limit', String(pagination.limit))
    params.set('offset', String(pagination.offset))
  }
  const qs = params.toString()
  return fetchJson<CostEvent[]>(
    `${BASE_URL}/companies/${companyId}/costs${qs ? `?${qs}` : ''}`,
  )
}

export function fetchCostsByAgent(companyId: string) {
  return fetchJson<CostByAgent[]>(
    `${BASE_URL}/companies/${companyId}/costs/by-agent`,
  )
}

// --- Company & License fetchers ---

export function fetchCompany(companyId: string) {
  return fetchJson<Company>(`${BASE_URL}/companies/${companyId}`)
}

export async function fetchLicense(
  companyId: string,
): Promise<LicenseKey | null> {
  try {
    return await fetchJson<LicenseKey>(
      `${BASE_URL}/companies/${companyId}/license`,
    )
  } catch {
    // 404 means no license — treat as free tier
    return null
  }
}

// --- LLM Keys ---

export interface LlmKeysData {
  openai: string | null
  anthropic: string | null
}

export function fetchLlmKeys(companyId: string) {
  return fetchJson<LlmKeysData>(`${BASE_URL}/companies/${companyId}/llm-keys`)
}

export async function saveLlmKeys(
  companyId: string,
  keys: { openai?: string; anthropic?: string },
): Promise<LlmKeysData> {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/llm-keys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return ((await res.json()) as ApiResponse<LlmKeysData>).data
}

// --- Mutation helpers ---

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    try {
      const errJson = JSON.parse(text) as { error?: string }
      if (errJson.error) throw new Error(errJson.error)
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith('API error')) throw e
    }
    throw new Error(`API error: ${res.status} ${text}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  return json.data
}

async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    try {
      const errJson = JSON.parse(text) as { error?: string }
      if (errJson.error) throw new Error(errJson.error)
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith('API error')) throw e
    }
    throw new Error(`API error: ${res.status} ${text}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  return json.data
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    try {
      const errJson = JSON.parse(text) as { error?: string }
      if (errJson.error) throw new Error(errJson.error)
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith('API error')) throw e
    }
    throw new Error(`API error: ${res.status} ${text}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  return json.data
}

export interface CreateAgentPayload {
  name: string
  title?: string
  role: string
  adapter_type: string
  adapter_config: Record<string, unknown>
  budget_monthly_cents: number
}

export function createAgent(companyId: string, payload: CreateAgentPayload) {
  return postJson<Agent>(
    `${BASE_URL}/companies/${companyId}/agents`,
    payload,
  )
}

export interface CreateTaskPayload {
  title: string
  description?: string
  priority: string
  assignee_agent_id?: string | null
  status: string
}

export function createTask(companyId: string, payload: CreateTaskPayload) {
  return postJson<Issue>(
    `${BASE_URL}/companies/${companyId}/issues`,
    payload,
  )
}

export interface WakeupResult {
  triggered: boolean
  exit_code: number | null
}

export function wakeupAgent(companyId: string, agentId: string) {
  return postJson<WakeupResult>(
    `${BASE_URL}/companies/${companyId}/agents/${agentId}/wakeup`,
    {},
  )
}

export function updateAgent(
  companyId: string,
  agentId: string,
  data: Partial<{ adapter_config: Record<string, unknown> }>,
) {
  return patchJson<Agent>(
    `${BASE_URL}/companies/${companyId}/agents/${agentId}`,
    data,
  )
}

export function pauseAgent(companyId: string, agentId: string) {
  return postJson<Agent>(`${BASE_URL}/companies/${companyId}/agents/${agentId}/pause`, {})
}

export function resumeAgent(companyId: string, agentId: string) {
  return postJson<Agent>(`${BASE_URL}/companies/${companyId}/agents/${agentId}/resume`, {})
}

export function terminateAgent(companyId: string, agentId: string) {
  return postJson<Agent>(`${BASE_URL}/companies/${companyId}/agents/${agentId}/terminate`, {})
}

export function fetchIssue(companyId: string, issueId: string) {
  return fetchJson<Issue>(`${BASE_URL}/companies/${companyId}/issues/${issueId}`)
}

export function fetchComments(companyId: string, issueId: string) {
  return fetchJson<Comment[]>(`${BASE_URL}/companies/${companyId}/issues/${issueId}/comments`)
}

export function createComment(
  companyId: string,
  issueId: string,
  content: string,
  parentId?: string | null,
) {
  return postJson<Comment>(
    `${BASE_URL}/companies/${companyId}/issues/${issueId}/comments`,
    { content, parent_id: parentId ?? null },
  )
}

export function updateComment(
  companyId: string,
  issueId: string,
  commentId: string,
  data: { content?: string; is_resolved?: boolean },
) {
  return patchJson<Comment>(
    `${BASE_URL}/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
    data,
  )
}

export function deleteComment(companyId: string, issueId: string, commentId: string) {
  return deleteJson<Comment>(
    `${BASE_URL}/companies/${companyId}/issues/${issueId}/comments/${commentId}`,
  )
}

export function updateIssue(companyId: string, issueId: string, data: Partial<Issue>) {
  return patchJson<Issue>(`${BASE_URL}/companies/${companyId}/issues/${issueId}`, data)
}

// --- Labels ---

export interface Label {
  id: string
  company_id: string
  name: string
  color: string
  description: string | null
  created_at: string
  updated_at: string
}

export function fetchIssueLabels(companyId: string, issueId: string) {
  return fetchJson<Label[]>(`${BASE_URL}/companies/${companyId}/issues/${issueId}/labels`)
}

export function fetchLabels(companyId: string) {
  return fetchJson<Label[]>(`${BASE_URL}/companies/${companyId}/labels`)
}
