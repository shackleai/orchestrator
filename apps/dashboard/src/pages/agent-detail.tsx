import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { useState } from 'react'
import { ArrowLeft, Bot, Activity, Play, Pause, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Select } from '@/components/ui/select'
import { fetchAgent, fetchHeartbeats, wakeupAgent, updateAgent, pauseAgent, resumeAgent, terminateAgent, type Agent, type HeartbeatRun } from '@/lib/api'
import { cn, formatCents, formatDate, formatRelativeTime } from '@/lib/utils'
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

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success',
  idle: 'secondary',
  paused: 'warning',
  error: 'destructive',
  terminated: 'destructive',
}

const heartbeatStatusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  success: 'success',
  running: 'info',
  failed: 'destructive',
  skipped: 'secondary',
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="h-20 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{children}</span>
    </div>
  )
}

function HeartbeatTable({ heartbeats }: { heartbeats: HeartbeatRun[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Started</TableHead>
          <TableHead className="hidden md:table-cell">Exit</TableHead>
          <TableHead>Error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {heartbeats.map((hb) => {
          const isOpen = expanded.has(hb.id)
          const hasOutput = hb.stdout_excerpt || hb.error || hb.usage_json
          return (
            <>
              <TableRow
                key={hb.id}
                className={hasOutput ? 'cursor-pointer hover:bg-muted/50' : ''}
                onClick={() => hasOutput && toggle(hb.id)}
              >
                <TableCell className="w-8 px-2">
                  {hasOutput && (
                    isOpen
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell className="capitalize">{hb.trigger_type}</TableCell>
                <TableCell>
                  <Badge
                    variant={heartbeatStatusVariant[hb.status] ?? 'secondary'}
                    className="capitalize"
                  >
                    {hb.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                  {formatRelativeTime(hb.started_at)}
                </TableCell>
                <TableCell className="hidden md:table-cell font-mono text-xs">
                  {hb.exit_code ?? '—'}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-destructive-foreground">
                  {hb.error ? hb.error.split('\n')[0] : '—'}
                </TableCell>
              </TableRow>
              {isOpen && (
                <TableRow key={`${hb.id}-detail`}>
                  <TableCell colSpan={6} className="bg-muted/30 p-4">
                    <div className="space-y-3">
                      {hb.stdout_excerpt && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent Output</p>
                          <pre className="max-h-[400px] overflow-auto rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap border">
                            {hb.stdout_excerpt}
                          </pre>
                        </div>
                      )}
                      {hb.error && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-destructive uppercase tracking-wide">Error</p>
                          <pre className="overflow-auto rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap border border-destructive/20">
                            {hb.error}
                          </pre>
                        </div>
                      )}
                      {hb.usage_json && (() => {
                        try {
                          const u = JSON.parse(hb.usage_json)
                          return (
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span>Provider: <strong>{u.provider}</strong></span>
                              <span>Model: <strong>{u.model}</strong></span>
                              <span>Input: <strong>{u.inputTokens}</strong> tokens</span>
                              <span>Output: <strong>{u.outputTokens}</strong> tokens</span>
                              <span>Cost: <strong>${(u.costCents / 100).toFixed(2)}</strong></span>
                            </div>
                          )
                        } catch { return null }
                      })()}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function AgentDetailPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const companyId = useCompanyId()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [editingSchedule, setEditingSchedule] = useState(false)
  const [scheduleChanged, setScheduleChanged] = useState(false)

  const pause = useMutation({
    mutationFn: () => pauseAgent(companyId!, agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', companyId, agentId] })
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent paused', 'info')
    },
    onError: (err: Error) => {
      toast(`Failed to pause agent: ${err.message}`, 'error')
    },
  })

  const resume = useMutation({
    mutationFn: () => resumeAgent(companyId!, agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', companyId, agentId] })
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent resumed', 'success')
    },
    onError: (err: Error) => {
      toast(`Failed to resume agent: ${err.message}`, 'error')
    },
  })

  const terminate = useMutation({
    mutationFn: () => terminateAgent(companyId!, agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent terminated', 'info')
      navigate('/agents')
    },
    onError: (err: Error) => {
      toast(`Failed to terminate agent: ${err.message}`, 'error')
    },
  })

  const wakeup = useMutation({
    mutationFn: () => wakeupAgent(companyId!, agentId!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['heartbeats', companyId, agentId] })
      queryClient.invalidateQueries({ queryKey: ['agent', companyId, agentId] })
      toast(`Heartbeat completed (exit: ${data?.exit_code ?? 'n/a'})`, 'success')
    },
    onError: (err: Error) => {
      toast(`Heartbeat failed: ${err.message}`, 'error')
    },
  })

  const updateSchedule = useMutation({
    mutationFn: (newCron: string) => {
      const currentConfig = agent?.adapter_config ?? {}
      const updatedConfig = { ...currentConfig }
      if (newCron) {
        updatedConfig.cron = newCron
      } else {
        delete updatedConfig.cron
      }
      return updateAgent(companyId!, agentId!, { adapter_config: updatedConfig })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', companyId, agentId] })
      setEditingSchedule(false)
      setScheduleChanged(true)
      toast('Schedule updated', 'success')
    },
    onError: (err: Error) => {
      toast(`Failed to update schedule: ${err.message}`, 'error')
    },
  })

  const {
    data: agent,
    isLoading: agentLoading,
    error: agentError,
  } = useQuery<Agent>({
    queryKey: ['agent', companyId, agentId],
    queryFn: () => fetchAgent(companyId!, agentId!),
    enabled: !!companyId && !!agentId,
    refetchInterval: 5_000,
  })

  const { data: heartbeats, isLoading: heartbeatsLoading } = useQuery<HeartbeatRun[]>({
    queryKey: ['heartbeats', companyId, agentId],
    queryFn: () => fetchHeartbeats(companyId!, agentId!),
    enabled: !!companyId && !!agentId,
    refetchInterval: 5_000,
  })

  if (agentLoading) return <DetailSkeleton />
  if (agentError) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load agent: {(agentError as Error).message}
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <Bot className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Agent not found</p>
      </div>
    )
  }

  const budgetPct =
    agent.budget_monthly_cents > 0
      ? Math.min(
          (agent.spent_monthly_cents / agent.budget_monthly_cents) * 100,
          100,
        )
      : 0

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/agents" aria-label="Back to agents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{agent.name}</h2>
          {agent.title && (
            <p className="text-sm text-muted-foreground">{agent.title}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => wakeup.mutate()}
            disabled={wakeup.isPending || !companyId || agent.status === 'terminated'}
          >
            {wakeup.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {wakeup.isPending ? 'Running...' : 'Run Heartbeat'}
          </Button>
          {agent.status !== 'terminated' && (
            <>
              {agent.status === 'paused' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending || !companyId}
                >
                  {resume.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 text-emerald-500" />
                  )}
                  {resume.isPending ? 'Resuming...' : 'Resume'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pause.mutate()}
                  disabled={pause.isPending || !companyId}
                >
                  {pause.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Pause className="h-4 w-4 text-amber-500" />
                  )}
                  {pause.isPending ? 'Pausing...' : 'Pause'}
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (window.confirm('Terminate agent? This cannot be undone.')) {
                    terminate.mutate()
                  }
                }}
                disabled={terminate.isPending || !companyId}
              >
                {terminate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {terminate.isPending ? 'Terminating...' : 'Terminate'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Wakeup result banner */}
      {wakeup.isSuccess && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm">
          Heartbeat triggered successfully.
          {wakeup.data.exit_code !== null && (
            <> Exit code: <code className="font-mono">{wakeup.data.exit_code}</code></>
          )}
        </div>
      )}
      {wakeup.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Failed to trigger heartbeat: {(wakeup.error as Error).message}
        </div>
      )}

      {/* Info cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <InfoRow label="Status">
              <Badge
                variant={statusVariant[agent.status] ?? 'secondary'}
                className="capitalize"
              >
                {agent.status}
              </Badge>
            </InfoRow>
            <InfoRow label="Role">{agent.role}</InfoRow>
            <InfoRow label="Adapter">
              <Badge variant="outline" className="capitalize font-mono text-xs">
                {agent.adapter_type}
              </Badge>
            </InfoRow>
            <InfoRow label="Last Heartbeat">
              {formatRelativeTime(agent.last_heartbeat_at)}
            </InfoRow>
            <InfoRow label="Schedule">
              {editingSchedule ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={(agent.adapter_config?.cron as string) ?? ''}
                    onChange={(e) => updateSchedule.mutate(e.target.value)}
                    disabled={updateSchedule.isPending}
                    className="h-7 text-xs"
                    aria-label="Change schedule"
                  >
                    {SCHEDULE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setEditingSchedule(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge
                    variant={agent.adapter_config?.cron ? 'info' : 'secondary'}
                    className="text-xs"
                  >
                    {cronToLabel(agent.adapter_config?.cron as string | undefined)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={() => setEditingSchedule(true)}
                  >
                    Change
                  </Button>
                </div>
              )}
            </InfoRow>
            {scheduleChanged && (
              <p className="px-0 py-2 text-xs text-amber-600">
                Restart the server for schedule changes to take effect.
              </p>
            )}
            {updateSchedule.isError && (
              <p className="px-0 py-2 text-xs text-destructive">
                Failed to update schedule: {(updateSchedule.error as Error).message}
              </p>
            )}
            <InfoRow label="Created">{formatDate(agent.created_at)}</InfoRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold">
                {formatCents(agent.spent_monthly_cents)}
              </span>
              <span className="text-sm text-muted-foreground">
                of {formatCents(agent.budget_monthly_cents)}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  budgetPct > 90
                    ? 'bg-red-500'
                    : budgetPct > 70
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                )}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {budgetPct.toFixed(0)}% of monthly budget used
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Heartbeat history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Heartbeat History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {heartbeatsLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : !heartbeats || heartbeats.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No heartbeat data yet
            </p>
          ) : (
            <HeartbeatTable heartbeats={heartbeats} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
