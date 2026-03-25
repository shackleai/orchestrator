import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { useDebounce } from '@/hooks/useDebounce'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import { Bot, Plus, Play, Loader2, Search, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  fetchAgents,
  createAgent,
  wakeupAgent,
  pauseAgent,
  resumeAgent,
  terminateAgent,
  type Agent,
  type CreateAgentPayload,
} from '@/lib/api'
import { Pagination } from '@/components/ui/pagination'
import { usePagination } from '@/hooks/usePagination'
import { cn, formatCents, formatRelativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'


function cronToLabel(cron: string | undefined): string {
  if (!cron) return 'Manual'
  if (cron === '*/1 * * * *') return 'Every 1m'
  if (cron === '*/5 * * * *') return 'Every 5m'
  if (cron === '*/15 * * * *') return 'Every 15m'
  if (cron === '*/30 * * * *') return 'Every 30m'
  if (cron === '0 * * * *') return 'Hourly'
  return cron
}

const SCHEDULE_OPTIONS = [
  { value: '', label: 'Manual only' },
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '*/30 * * * *', label: 'Every 30 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
] as const

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  active: 'success',
  idle: 'secondary',
  paused: 'warning',
  error: 'destructive',
  terminated: 'destructive',
}

const ROLES = ['worker', 'manager', 'ceo'] as const
const ADAPTER_TYPES = ['process', 'http', 'claude', 'mcp', 'openclaw', 'crewai'] as const

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
] as const

interface AdapterFields {
  command: string
  args: string
  url: string
  authHeaders: string
  model: string
  agentName: string
  serverCommand: string
}

function buildAdapterConfig(
  adapterType: string,
  fields: AdapterFields,
  systemPrompt: string,
  timeout: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = { timeout }
  if (systemPrompt.trim()) {
    base.system_prompt = systemPrompt.trim()
  }

  switch (adapterType) {
    case 'process':
      return {
        ...base,
        command: fields.command,
        args: fields.args
          ? fields.args.split(/\s+/).filter(Boolean)
          : [],
      }
    case 'http': {
      const config: Record<string, unknown> = { ...base, url: fields.url }
      if (fields.authHeaders.trim()) {
        try {
          config.headers = JSON.parse(fields.authHeaders)
        } catch {
          config.headers = { Authorization: fields.authHeaders.trim() }
        }
      }
      return config
    }
    case 'claude':
      return {
        ...base,
        prompt: systemPrompt.trim() || '',
        model: fields.model || 'claude-sonnet-4-20250514',
      }
    case 'mcp':
      return { ...base, command: fields.serverCommand, toolName: 'run' }
    case 'openclaw':
      return { ...base, agentName: fields.agentName }
    case 'crewai':
    default:
      return { ...base, entrypoint: fields.command }
  }
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {formatCents(spent)} / {formatCents(budget)}
      </span>
    </div>
  )
}

function AgentsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-20 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AgentsEmpty({ filtered }: { filtered?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      {filtered ? (
        <>
          <Search className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">No matching agents</p>
          <p className="text-xs text-muted-foreground">
            Try adjusting your search or filter criteria.
          </p>
        </>
      ) : (
        <>
          <Bot className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-xs text-muted-foreground">
            Create an agent to get started with orchestration.
          </p>
        </>
      )}
    </div>
  )
}

function CreateAgentForm({
  companyId,
  onClose,
}: {
  companyId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<string>('worker')
  const [adapterType, setAdapterType] = useState<string>('process')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [timeout, setTimeout] = useState(120)
  const [budget, setBudget] = useState(500)
  const [schedule, setSchedule] = useState('')

  // Adapter-specific fields
  const [adapterFields, setAdapterFields] = useState<AdapterFields>({
    command: '',
    args: '',
    url: '',
    authHeaders: '',
    model: 'claude-sonnet-4-20250514',
    agentName: '',
    serverCommand: '',
  })

  const updateField = (field: keyof AdapterFields, value: string) => {
    setAdapterFields((prev) => ({ ...prev, [field]: value }))
  }

  const mutation = useMutation({
    mutationFn: (payload: CreateAgentPayload) => createAgent(companyId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent hired successfully', 'success')
      onClose()
    },
    onError: (err: Error) => {
      toast(`Failed to create agent: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const adapterConfig = {
      ...buildAdapterConfig(adapterType, adapterFields, systemPrompt, timeout),
      ...(schedule ? { cron: schedule } : {}),
    }

    mutation.mutate({
      name: name.trim(),
      title: title.trim() || undefined,
      role,
      adapter_type: adapterType,
      adapter_config: adapterConfig,
      budget_monthly_cents: Math.round(budget * 100),
    })
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. code-reviewer"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="agent-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Code Reviewer"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-role" className="text-sm font-medium">
                Role
              </label>
              <Select
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-adapter" className="text-sm font-medium">
                Adapter Type
              </label>
              <Select
                id="agent-adapter"
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value)}
              >
                {ADAPTER_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* System prompt — available for all adapters */}
          <div className="space-y-1.5">
            <label htmlFor="agent-system-prompt" className="text-sm font-medium">
              System Prompt
            </label>
            <textarea
              id="agent-system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Instructions for the agent's behavior and role..."
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Define the agent's persona, capabilities, and constraints.
            </p>
          </div>

          {/* Adapter-specific configuration */}
          {adapterType === 'process' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="adapter-command" className="text-sm font-medium">
                  Command
                </label>
                <Input
                  id="adapter-command"
                  value={adapterFields.command}
                  onChange={(e) => updateField('command', e.target.value)}
                  placeholder="python agent.py"
                />
                <p className="text-xs text-muted-foreground">
                  The executable or script to run.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adapter-args" className="text-sm font-medium">
                  Arguments
                </label>
                <Input
                  id="adapter-args"
                  value={adapterFields.args}
                  onChange={(e) => updateField('args', e.target.value)}
                  placeholder="--verbose --mode=worker"
                />
                <p className="text-xs text-muted-foreground">
                  Space-separated command arguments.
                </p>
              </div>
            </div>
          )}

          {adapterType === 'http' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="adapter-url" className="text-sm font-medium">
                  URL
                </label>
                <Input
                  id="adapter-url"
                  value={adapterFields.url}
                  onChange={(e) => updateField('url', e.target.value)}
                  placeholder="https://agent.example.com/run"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adapter-auth-headers" className="text-sm font-medium">
                  Auth Headers
                </label>
                <Input
                  id="adapter-auth-headers"
                  value={adapterFields.authHeaders}
                  onChange={(e) => updateField('authHeaders', e.target.value)}
                  placeholder='Bearer token or {"Authorization": "..."}'
                />
                <p className="text-xs text-muted-foreground">
                  A bearer token or JSON object of headers.
                </p>
              </div>
            </div>
          )}

          {adapterType === 'claude' && (
            <div className="space-y-1.5">
              <label htmlFor="adapter-model" className="text-sm font-medium">
                Model
              </label>
              <Select
                id="adapter-model"
                value={adapterFields.model}
                onChange={(e) => updateField('model', e.target.value)}
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {adapterType === 'mcp' && (
            <div className="space-y-1.5">
              <label htmlFor="adapter-server-command" className="text-sm font-medium">
                Server Command
              </label>
              <Input
                id="adapter-server-command"
                value={adapterFields.serverCommand}
                onChange={(e) => updateField('serverCommand', e.target.value)}
                placeholder="npx @shackleai/mcp-server"
              />
              <p className="text-xs text-muted-foreground">
                The command to start the MCP server.
              </p>
            </div>
          )}

          {adapterType === 'openclaw' && (
            <div className="space-y-1.5">
              <label htmlFor="adapter-agent-name" className="text-sm font-medium">
                Agent Name
              </label>
              <Input
                id="adapter-agent-name"
                value={adapterFields.agentName}
                onChange={(e) => updateField('agentName', e.target.value)}
                placeholder="my-openclaw-agent"
              />
              <p className="text-xs text-muted-foreground">
                The name of the OpenClaw agent to invoke.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-timeout" className="text-sm font-medium">
                Timeout (seconds)
              </label>
              <Input
                id="agent-timeout"
                type="number"
                min={1}
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="agent-budget" className="text-sm font-medium">
                Monthly Budget ($)
              </label>
              <Input
                id="agent-budget"
                type="number"
                min={0}
                step={1}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-schedule" className="text-sm font-medium">
              Schedule
            </label>
            <Select
              id="agent-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            >
              {SCHEDULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Automatically trigger heartbeats on a cron schedule.
            </p>
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mutation.isPending ? 'Creating...' : 'Create Agent'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function AgentActions({ companyId, agent }: { companyId: string; agent: Agent }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [confirmingTerminate, setConfirmingTerminate] = useState(false)

  const wakeup = useMutation({
    mutationFn: () => wakeupAgent(companyId, agent.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['heartbeats', companyId, agent.id] })
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast(`Heartbeat triggered (exit: ${data?.exit_code ?? 'n/a'})`, 'success')
    },
    onError: (err: Error) => {
      toast(`Heartbeat failed: ${err.message}`, 'error')
    },
  })

  const pause = useMutation({
    mutationFn: () => pauseAgent(companyId, agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent paused', 'info')
    },
    onError: (err: Error) => {
      toast(`Failed to pause agent: ${err.message}`, 'error')
    },
  })

  const resume = useMutation({
    mutationFn: () => resumeAgent(companyId, agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent resumed', 'success')
    },
    onError: (err: Error) => {
      toast(`Failed to resume agent: ${err.message}`, 'error')
    },
  })

  const terminate = useMutation({
    mutationFn: () => terminateAgent(companyId, agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      setConfirmingTerminate(false)
      toast('Agent terminated', 'info')
    },
    onError: (err: Error) => {
      toast(`Failed to terminate agent: ${err.message}`, 'error')
      setConfirmingTerminate(false)
    },
  })

  const isPending = wakeup.isPending || pause.isPending || resume.isPending || terminate.isPending

  if (confirmingTerminate) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-destructive whitespace-nowrap">Are you sure?</span>
        <Button
          variant="destructive"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            terminate.mutate()
          }}
          disabled={terminate.isPending}
        >
          {terminate.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            'Yes, terminate'
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmingTerminate(false)
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          wakeup.mutate()
        }}
        disabled={isPending || agent.status === 'terminated'}
        aria-label="Run heartbeat"
      >
        {wakeup.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Run
      </Button>
      {agent.status !== 'terminated' && (
        <>
          {agent.status === 'paused' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                resume.mutate()
              }}
              disabled={isPending}
              aria-label="Resume agent"
            >
              {resume.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Resume'
              )}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                pause.mutate()
              }}
              disabled={isPending}
              aria-label="Pause agent"
            >
              {pause.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Pause'
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmingTerminate(true)
            }}
            disabled={isPending}
            aria-label="Terminate agent"
          >
            Terminate
          </Button>
        </>
      )}
    </div>
  )
}

export function AgentsPage() {
  const companyId = useCompanyId()
  const agentsInterval = usePollingInterval(POLLING_INTERVALS.agents)
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [adapterFilter, setAdapterFilter] = useState('')
  const { page, perPage, offset, setPage, setPerPage } = usePagination({ defaultPerPage: 25 })

  const debouncedSearch = useDebounce(search, 300)

  const { data: rawAgents, isLoading, error } = useQuery<Agent[]>({
    queryKey: ['agents', companyId, page, perPage],
    queryFn: () =>
      fetchAgents(companyId!, {
        limit: perPage + 1,
        offset,
      }),
    enabled: !!companyId,
    refetchInterval: agentsInterval,
  })

  const hasMore = (rawAgents?.length ?? 0) > perPage
  const agents = rawAgents ? rawAgents.slice(0, perPage) : undefined

  const STATUS_OPTIONS = ['idle', 'active', 'paused', 'terminated'] as const

  const filteredAgents = (agents ?? []).filter((a) => {
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase()
      const matchesName = a.name.toLowerCase().includes(query)
      const matchesRole = a.role.toLowerCase().includes(query)
      const matchesTitle = a.title?.toLowerCase().includes(query) ?? false
      if (!matchesName && !matchesRole && !matchesTitle) return false
    }
    if (statusFilter && a.status !== statusFilter) return false
    if (adapterFilter && a.adapter_type !== adapterFilter) return false
    return true
  })

  const hasActiveFilters = search !== '' || statusFilter !== '' || adapterFilter !== ''
  const pageCount = agents?.length ?? 0

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('')
    setAdapterFilter('')
  }

  if (isLoading) return <AgentsSkeleton />
  if (error) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load agents: {(error as Error).message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agents</h2>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={!companyId}>
          <Plus className="h-4 w-4" />
          Hire Agent
        </Button>
      </div>

      {showCreate && companyId && (
        <CreateAgentForm
          companyId={companyId}
          onClose={() => setShowCreate(false)}
        />
      )}

      {pageCount > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, role, or title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search agents by name, role, or title"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-[150px]"
              aria-label="Filter by status"
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
            <Select
              value={adapterFilter}
              onChange={(e) => setAdapterFilter(e.target.value)}
              className="w-full sm:w-[150px]"
              aria-label="Filter by adapter type"
            >
              <option value="">All Adapters</option>
              {ADAPTER_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </option>
              ))}
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="shrink-0"
                aria-label="Clear all filters"
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      {pageCount > 0 && hasActiveFilters && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredAgents.length} of {pageCount} agents
        </p>
      )}

      {pageCount === 0 && page === 0 ? (
        <AgentsEmpty />
      ) : filteredAgents.length === 0 ? (
        <AgentsEmpty filtered />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Role</TableHead>
                  <TableHead className="hidden lg:table-cell">Adapter</TableHead>
                  <TableHead className="hidden sm:table-cell">Budget</TableHead>
                  <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                  <TableHead className="hidden md:table-cell">Last Heartbeat</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAgents.map((agent) => (
                  <TableRow
                    key={agent.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/agents/${agent.id}`)
                    }}
                  >
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant[agent.status] ?? 'secondary'}
                        className="capitalize"
                      >
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {agent.role}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline" className="capitalize font-mono text-xs">
                        {agent.adapter_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <BudgetBar
                        spent={agent.spent_monthly_cents}
                        budget={agent.budget_monthly_cents}
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge
                        variant={agent.adapter_config?.cron ? 'info' : 'secondary'}
                        className="text-xs"
                      >
                        {cronToLabel(agent.adapter_config?.cron as string | undefined)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatRelativeTime(agent.last_heartbeat_at)}
                    </TableCell>
                    <TableCell>
                      {companyId && (
                        <AgentActions companyId={companyId} agent={agent} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={perPage}
              total={-1}
              hasMore={hasMore}
              onPageChange={setPage}
              onPageSizeChange={setPerPage}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
