import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import { usePagination } from '@/hooks/usePagination'
import { MessageSquare, Clock, Loader2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import {
  fetchAllHeartbeats,
  fetchAgents,
  type HeartbeatRun,
  type Agent,
} from '@/lib/api'
import { formatCents, formatDuration, formatRelativeTime } from '@/lib/utils'

const statusVariant: Record<
  string,
  'success' | 'warning' | 'destructive' | 'secondary' | 'info'
> = {
  success: 'success',
  running: 'info',
  failed: 'destructive',
  skipped: 'secondary',
}

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'skipped', label: 'Skipped' },
]

interface ParsedUsage {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  totalTokens?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls?: Array<Record<string, any>>
  error_category?: string
}

function parseUsageJson(usageJson: string | null): ParsedUsage | null {
  if (!usageJson) return null
  try {
    return JSON.parse(usageJson) as ParsedUsage
  } catch {
    return null
  }
}

function SessionsSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SessionsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <MessageSquare className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No sessions found</p>
      <p className="text-xs text-muted-foreground">
        Agent sessions will appear here as agents execute heartbeat runs.
      </p>
    </div>
  )
}

function TokenBadge({ usage }: { usage: ParsedUsage | null }) {
  if (!usage || usage.inputTokens === undefined) return <span className="text-muted-foreground">--</span>
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  return (
    <span className="font-mono text-xs">
      {total.toLocaleString()}
    </span>
  )
}

function CostCell({ usage }: { usage: ParsedUsage | null }) {
  if (!usage || usage.costCents === undefined) return <span className="text-muted-foreground">--</span>
  return (
    <span className="text-sm font-medium">
      {formatCents(usage.costCents)}
    </span>
  )
}

export function SessionsPage() {
  const companyId = useCompanyId()
  const navigate = useNavigate()
  const pollingInterval = usePollingInterval(POLLING_INTERVALS.agents)
  const { page, perPage, offset, setPage, setPerPage, resetPage } =
    usePagination({ defaultPerPage: 25 })

  const [statusFilter, setStatusFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    resetPage()
  }

  const handleAgentChange = (value: string) => {
    setAgentFilter(value)
    resetPage()
  }

  // Fetch all agents for the filter dropdown and name resolution
  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  })

  const agentMap = new Map(agents?.map((a) => [a.id, a]) ?? [])

  const { data: rawSessions, isLoading, error } = useQuery<HeartbeatRun[]>({
    queryKey: ['sessions', companyId, statusFilter, agentFilter, page, perPage],
    queryFn: () =>
      fetchAllHeartbeats(
        companyId!,
        {
          status: statusFilter || undefined,
          agent_id: agentFilter || undefined,
        },
        { limit: perPage + 1, offset },
      ),
    enabled: !!companyId,
    refetchInterval: pollingInterval,
  })

  const hasMore = (rawSessions?.length ?? 0) > perPage
  const sessions = rawSessions ? rawSessions.slice(0, perPage) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground">
            Agent conversation history and execution details
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={agentFilter}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="w-40"
            aria-label="Filter by agent"
          >
            <option value="">All agents</option>
            {agents?.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="w-36"
            aria-label="Filter by status"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <SessionsSkeleton />
      ) : error ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Failed to load sessions: {(error as Error).message}
        </div>
      ) : !sessions || sessions.length === 0 ? (
        page === 0 ? (
          <SessionsEmpty />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No more sessions to display.
          </div>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} on
              this page
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Trigger
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Duration
                  </TableHead>
                  <TableHead className="hidden lg:table-cell text-right">
                    Tokens
                  </TableHead>
                  <TableHead className="hidden lg:table-cell text-right">
                    Cost
                  </TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const agent = agentMap.get(session.agent_id)
                  const usage = parseUsageJson(session.usage_json)
                  const isRunning = session.status === 'running'

                  return (
                    <TableRow
                      key={session.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate(
                          `/sessions/${session.id}?agent=${session.agent_id}`,
                        )
                      }
                      role="link"
                      tabIndex={0}
                      aria-label={`View session for ${agent?.name ?? 'agent'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(
                            `/sessions/${session.id}?agent=${session.agent_id}`,
                          )
                        }
                      }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {agent?.name ?? session.agent_id.slice(0, 8)}
                          </span>
                          {agent?.adapter_type && (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono"
                            >
                              {agent.adapter_type}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              statusVariant[session.status] ?? 'secondary'
                            }
                            className="capitalize"
                          >
                            {session.status}
                          </Badge>
                          {isRunning && (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="text-xs capitalize text-muted-foreground">
                          {session.trigger_type}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right">
                        <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDuration(
                            session.started_at,
                            session.finished_at,
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        <TokenBadge usage={usage} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        <CostCell usage={usage} />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelativeTime(session.created_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
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
