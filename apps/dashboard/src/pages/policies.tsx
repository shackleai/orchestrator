import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCompanyId } from '@/hooks/useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import { Shield, Plus, Pencil, Trash2, Loader2, Search, X } from 'lucide-react'
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
  fetchPolicies,
  fetchAgents,
  createPolicy,
  updatePolicy,
  deletePolicy,
  type Policy,
  type CreatePolicyPayload,
  type UpdatePolicyPayload,
  type Agent,
} from '@/lib/api'
import { Pagination } from '@/components/ui/pagination'
import { usePagination } from '@/hooks/usePagination'
import { useToast } from '@/components/ui/toast'

const ACTION_OPTIONS = ['allow', 'deny', 'log'] as const

const actionVariant: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  allow: 'success',
  deny: 'destructive',
  log: 'warning',
}

function PoliciesSkeleton() {
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

function PoliciesEmpty({ filtered }: { filtered?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      {filtered ? (
        <>
          <Search className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">No matching policies</p>
          <p className="text-xs text-muted-foreground">
            Try adjusting your search or filter criteria.
          </p>
        </>
      ) : (
        <>
          <Shield className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">No policies yet</p>
          <p className="text-xs text-muted-foreground">
            Create a governance policy to control tool access for your agents.
          </p>
        </>
      )}
    </div>
  )
}

function PolicyForm({
  companyId,
  agents,
  initial,
  onClose,
}: {
  companyId: string
  agents: Agent[]
  initial?: Policy
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const isEditing = !!initial

  const [name, setName] = useState(initial?.name ?? '')
  const [toolPattern, setToolPattern] = useState(initial?.tool_pattern ?? '')
  const [action, setAction] = useState(initial?.action ?? 'allow')
  const [priority, setPriority] = useState(initial?.priority ?? 0)
  const [agentId, setAgentId] = useState<string>(initial?.agent_id ?? '')
  const [maxCallsPerHour, setMaxCallsPerHour] = useState<string>(
    initial?.max_calls_per_hour != null ? String(initial.max_calls_per_hour) : '',
  )

  const createMutation = useMutation({
    mutationFn: (payload: CreatePolicyPayload) => createPolicy(companyId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies', companyId] })
      toast('Policy created successfully', 'success')
      onClose()
    },
    onError: (err: Error) => {
      toast(`Failed to create policy: ${err.message}`, 'error')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: UpdatePolicyPayload) =>
      updatePolicy(companyId, initial!.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies', companyId] })
      toast('Policy updated successfully', 'success')
      onClose()
    },
    onError: (err: Error) => {
      toast(`Failed to update policy: ${err.message}`, 'error')
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !toolPattern.trim()) return

    const payload = {
      name: name.trim(),
      tool_pattern: toolPattern.trim(),
      action,
      priority,
      agent_id: agentId || null,
      max_calls_per_hour: maxCallsPerHour ? Number(maxCallsPerHour) : null,
    }

    if (isEditing) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const mutationError = createMutation.error ?? updateMutation.error

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="policy-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="policy-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Block destructive GitHub ops"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="policy-tool-pattern" className="text-sm font-medium">
                Tool Pattern <span className="text-destructive">*</span>
              </label>
              <Input
                id="policy-tool-pattern"
                value={toolPattern}
                onChange={(e) => setToolPattern(e.target.value)}
                placeholder="e.g. github.*, *, slack.send"
                required
              />
              <p className="text-xs text-muted-foreground">
                Glob pattern matching tool names.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="policy-action" className="text-sm font-medium">
                Action
              </label>
              <Select
                id="policy-action"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a.charAt(0).toUpperCase() + a.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="policy-priority" className="text-sm font-medium">
                Priority
              </label>
              <Input
                id="policy-priority"
                type="number"
                min={0}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Higher priority rules are evaluated first.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="policy-max-calls" className="text-sm font-medium">
                Max Calls/Hour
              </label>
              <Input
                id="policy-max-calls"
                type="number"
                min={0}
                value={maxCallsPerHour}
                onChange={(e) => setMaxCallsPerHour(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="policy-agent" className="text-sm font-medium">
              Agent Scope
            </label>
            <Select
              id="policy-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">All agents (company-wide)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>

          {mutationError && (
            <p className="text-sm text-destructive">
              {(mutationError as Error).message}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={isPending || !name.trim() || !toolPattern.trim()}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending
                ? isEditing ? 'Saving...' : 'Creating...'
                : isEditing ? 'Save Changes' : 'Create Policy'}
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

function DeleteConfirmation({
  companyId,
  policy,
  onClose,
}: {
  companyId: string
  policy: Policy
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => deletePolicy(companyId, policy.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies', companyId] })
      toast('Policy deleted', 'info')
      onClose()
    },
    onError: (err: Error) => {
      toast(`Failed to delete policy: ${err.message}`, 'error')
      onClose()
    },
  })

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-destructive whitespace-nowrap">Delete?</span>
      <Button
        variant="destructive"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          mutation.mutate()
        }}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          'Yes'
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        No
      </Button>
    </div>
  )
}

function PolicyActions({
  companyId,
  policy,
  _agents,
  onEdit,
}: {
  companyId: string
  policy: Policy
  _agents: Agent[]
  onEdit: (policy: Policy) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (confirmingDelete) {
    return (
      <DeleteConfirmation
        companyId={companyId}
        policy={policy}
        onClose={() => setConfirmingDelete(false)}
      />
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(policy)
        }}
        aria-label={`Edit policy ${policy.name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation()
          setConfirmingDelete(true)
        }}
        aria-label={`Delete policy ${policy.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function PoliciesPage() {
  const companyId = useCompanyId()
  const pollingInterval = usePollingInterval(POLLING_INTERVALS.agents)
  const [showCreate, setShowCreate] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [scopeFilter, setScopeFilter] = useState('')
  const [search, setSearch] = useState('')
  const { page, perPage, offset, setPage, setPerPage } = usePagination({ defaultPerPage: 25 })

  const { data: rawPolicies, isLoading, error } = useQuery<Policy[]>({
    queryKey: ['policies', companyId, page, perPage],
    queryFn: () =>
      fetchPolicies(companyId!, {
        limit: perPage + 1,
        offset,
      }),
    enabled: !!companyId,
    refetchInterval: pollingInterval,
  })

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!, { limit: 200, offset: 0 }),
    enabled: !!companyId,
  })

  const hasMore = (rawPolicies?.length ?? 0) > perPage
  const policies = rawPolicies ? rawPolicies.slice(0, perPage) : undefined

  const agentNameMap = new Map<string, string>()
  for (const a of agents ?? []) {
    agentNameMap.set(a.id, a.name)
  }

  const filteredPolicies = (policies ?? []).filter((p) => {
    if (search) {
      const query = search.toLowerCase()
      const matchesName = p.name.toLowerCase().includes(query)
      const matchesPattern = p.tool_pattern.toLowerCase().includes(query)
      if (!matchesName && !matchesPattern) return false
    }
    if (actionFilter && p.action !== actionFilter) return false
    if (scopeFilter === 'company' && p.agent_id !== null) return false
    if (scopeFilter === 'agent' && p.agent_id === null) return false
    return true
  })

  const hasActiveFilters = search !== '' || actionFilter !== '' || scopeFilter !== ''
  const pageCount = policies?.length ?? 0

  const clearFilters = () => {
    setSearch('')
    setActionFilter('')
    setScopeFilter('')
  }

  const handleEdit = (policy: Policy) => {
    setEditingPolicy(policy)
    setShowCreate(false)
  }

  const handleCloseForm = () => {
    setShowCreate(false)
    setEditingPolicy(null)
  }

  if (isLoading) return <PoliciesSkeleton />
  if (error) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load policies: {(error as Error).message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Policies</h2>
        <Button
          size="sm"
          onClick={() => {
            setShowCreate(true)
            setEditingPolicy(null)
          }}
          disabled={!companyId}
        >
          <Plus className="h-4 w-4" />
          Create Policy
        </Button>
      </div>

      {(showCreate || editingPolicy) && companyId && (
        <PolicyForm
          companyId={companyId}
          agents={agents ?? []}
          initial={editingPolicy ?? undefined}
          onClose={handleCloseForm}
        />
      )}

      {pageCount > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or tool pattern..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search policies by name or tool pattern"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full sm:w-[150px]"
              aria-label="Filter by action"
            >
              <option value="">All Actions</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </option>
              ))}
            </Select>
            <Select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="w-full sm:w-[150px]"
              aria-label="Filter by scope"
            >
              <option value="">All Scopes</option>
              <option value="company">Company-wide</option>
              <option value="agent">Agent-specific</option>
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
          Showing {filteredPolicies.length} of {pageCount} policies
        </p>
      )}

      {pageCount === 0 && page === 0 ? (
        <PoliciesEmpty />
      ) : filteredPolicies.length === 0 ? (
        <PoliciesEmpty filtered />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tool Pattern</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">Priority</TableHead>
                  <TableHead className="hidden md:table-cell">Scope</TableHead>
                  <TableHead className="hidden lg:table-cell">Rate Limit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPolicies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell className="font-medium">{policy.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {policy.tool_pattern}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={actionVariant[policy.action] ?? 'secondary'}
                        className="capitalize"
                      >
                        {policy.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {policy.priority}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {policy.agent_id ? (
                        <Badge variant="outline" className="text-xs">
                          {agentNameMap.get(policy.agent_id) ?? 'Unknown agent'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          All agents
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                      {policy.max_calls_per_hour != null
                        ? `${policy.max_calls_per_hour}/hr`
                        : 'Unlimited'}
                    </TableCell>
                    <TableCell>
                      {companyId && (
                        <PolicyActions
                          companyId={companyId}
                          policy={policy}
                          agents={agents ?? []}
                          onEdit={handleEdit}
                        />
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
