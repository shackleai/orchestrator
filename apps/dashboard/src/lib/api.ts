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
  error: string | null
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

// --- Fetchers ---

export function fetchDashboard(companyId: string) {
  return fetchJson<DashboardData>(`${BASE_URL}/companies/${companyId}/dashboard`)
}

export function fetchAgents(companyId: string) {
  return fetchJson<Agent[]>(`${BASE_URL}/companies/${companyId}/agents`)
}

export function fetchAgent(companyId: string, agentId: string) {
  return fetchJson<Agent>(`${BASE_URL}/companies/${companyId}/agents/${agentId}`)
}

export function fetchHeartbeats(companyId: string, agentId: string) {
  return fetchJson<HeartbeatRun[]>(
    `${BASE_URL}/companies/${companyId}/agents/${agentId}/heartbeats`,
  )
}

export function fetchTasks(
  companyId: string,
  filters?: { status?: string; priority?: string },
) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.priority) params.set('priority', filters.priority)
  const qs = params.toString()
  return fetchJson<Issue[]>(
    `${BASE_URL}/companies/${companyId}/issues${qs ? `?${qs}` : ''}`,
  )
}

export function fetchActivity(
  companyId: string,
  filters?: { entity_type?: string; from?: string; to?: string },
) {
  const params = new URLSearchParams()
  if (filters?.entity_type) params.set('entity_type', filters.entity_type)
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
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
) {
  const params = new URLSearchParams()
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
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
