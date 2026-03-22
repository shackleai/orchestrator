import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import { useState } from 'react'
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Circle,
  DollarSign,
  Shield,
  Cpu,
  Database,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchHeartbeatRun,
  fetchHeartbeatRunEvents,
  fetchAgent,
  wakeupAgent,
  type HeartbeatRun,
  type HeartbeatRunEvent,
  type Agent,
} from '@/lib/api'
import {
  cn,
  formatDate,
  formatDuration,
  formatRelativeTime,
  humanizeEventType,
  redactPaths,
} from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  success: 'success',
  running: 'info',
  failed: 'destructive',
  skipped: 'secondary',
}

const eventIcons: Record<string, typeof Circle> = {
  adapter_loaded: Cpu,
  governance_checked: Shield,
  budget_checked: DollarSign,
  context_built: Database,
  adapter_started: Play,
  adapter_finished: CheckCircle2,
  cost_recorded: DollarSign,
  session_saved: Database,
  error: AlertTriangle,
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}

function MetadataCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function EventTimeline({
  events,
  runStartedAt,
}: {
  events: HeartbeatRunEvent[]
  runStartedAt: string | null
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runStart = runStartedAt ? new Date(runStartedAt).getTime() : null

  return (
    <div className="space-y-0">
      {events.map((event, index) => {
        const isCollapsed = collapsed.has(event.id)
        const Icon = eventIcons[event.event_type] ?? Zap
        const isError = event.event_type === 'error'
        const payload = event.payload
        const hasContent = payload && Object.keys(payload).length > 0

        // Calculate relative time from run start
        const eventTime = new Date(event.created_at).getTime()
        const relativeMs = runStart ? eventTime - runStart : null
        const relativeLabel = relativeMs !== null && relativeMs >= 0
          ? relativeMs < 1000 ? `+${relativeMs}ms` : `+${(relativeMs / 1000).toFixed(1)}s`
          : null

        return (
          <div key={event.id} className="relative flex gap-3">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                  isError
                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              {index < events.length - 1 && (
                <div className="w-px flex-1 bg-border" />
              )}
            </div>

            {/* Event content */}
            <div className={cn('flex-1 pb-6', index === events.length - 1 && 'pb-0')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {humanizeEventType(event.event_type)}
                  </span>
                  {relativeLabel && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {relativeLabel}
                    </span>
                  )}
                </div>
                {hasContent && (
                  <button
                    onClick={() => toggle(event.id)}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                    aria-label={isCollapsed ? 'Expand event details' : 'Collapse event details'}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {isCollapsed ? 'Show' : 'Hide'}
                  </button>
                )}
              </div>

              {hasContent && !isCollapsed && (
                <div className="mt-2">
                  <EventPayload payload={payload} isError={isError} />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EventPayload({
  payload,
  isError,
}: {
  payload: Record<string, unknown>
  isError: boolean
}) {
  // Check for stdout/stderr text content
  const stdout = payload.stdout as string | undefined
  const stderr = payload.stderr as string | undefined
  const message = payload.message as string | undefined
  const errorMsg = payload.error as string | undefined

  // Check for structured data we can render nicely
  const cost = payload.cost_cents as number | undefined
  const provider = payload.provider as string | undefined
  const model = payload.model as string | undefined
  const inputTokens = payload.input_tokens as number | undefined
  const outputTokens = payload.output_tokens as number | undefined

  return (
    <div className="space-y-2">
      {/* Structured cost data */}
      {(cost !== undefined || provider || model) && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">
          {provider && <span>Provider: <strong>{provider}</strong></span>}
          {model && <span>Model: <strong>{model}</strong></span>}
          {inputTokens !== undefined && <span>Input: <strong>{inputTokens}</strong> tokens</span>}
          {outputTokens !== undefined && <span>Output: <strong>{outputTokens}</strong> tokens</span>}
          {cost !== undefined && <span>Cost: <strong>${(cost / 100).toFixed(4)}</strong></span>}
        </div>
      )}

      {/* Error message */}
      {(errorMsg || (isError && message)) && (
        <pre className={cn(
          'overflow-auto rounded-md p-3 text-xs font-mono whitespace-pre-wrap border',
          'border-destructive/20 bg-destructive/5 text-destructive',
        )}>
          {redactPaths(errorMsg || message || '')}
        </pre>
      )}

      {/* Stdout */}
      {stdout && (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            stdout
          </p>
          <pre className="max-h-[300px] overflow-auto rounded-md border bg-background p-3 text-xs font-mono whitespace-pre-wrap">
            {redactPaths(stdout)}
          </pre>
        </div>
      )}

      {/* Stderr */}
      {stderr && (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
            stderr
          </p>
          <pre className="max-h-[200px] overflow-auto rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs font-mono whitespace-pre-wrap">
            {redactPaths(stderr)}
          </pre>
        </div>
      )}

      {/* Non-special message */}
      {message && !isError && !errorMsg && (
        <p className="text-xs text-muted-foreground">{redactPaths(message)}</p>
      )}

      {/* Generic payload (fallback) — render keys we haven't already handled */}
      {(() => {
        const handled = new Set(['stdout', 'stderr', 'message', 'error', 'cost_cents', 'provider', 'model', 'input_tokens', 'output_tokens'])
        const remaining = Object.entries(payload).filter(([k]) => !handled.has(k))
        if (remaining.length === 0) return null
        return (
          <pre className="max-h-[200px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">
            {redactPaths(JSON.stringify(Object.fromEntries(remaining), null, 2))}
          </pre>
        )
      })()}
    </div>
  )
}

export function RunTranscriptPage() {
  const { id: agentId, runId } = useParams<{ id: string; runId: string }>()
  const companyId = useCompanyId()
  const pollingInterval = usePollingInterval(POLLING_INTERVALS.agents)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useQuery<HeartbeatRun>({
    queryKey: ['heartbeat-run', companyId, runId],
    queryFn: () => fetchHeartbeatRun(companyId!, runId!),
    enabled: !!companyId && !!runId,
    refetchInterval: pollingInterval,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<HeartbeatRunEvent[]>({
    queryKey: ['heartbeat-run-events', companyId, runId],
    queryFn: () => fetchHeartbeatRunEvents(companyId!, runId!),
    enabled: !!companyId && !!runId,
    refetchInterval: pollingInterval,
  })

  const { data: agent } = useQuery<Agent>({
    queryKey: ['agent', companyId, agentId],
    queryFn: () => fetchAgent(companyId!, agentId!),
    enabled: !!companyId && !!agentId,
    staleTime: 30_000,
  })

  const wakeup = useMutation({
    mutationFn: () => wakeupAgent(companyId!, agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['heartbeats', companyId, agentId] })
      queryClient.invalidateQueries({ queryKey: ['agent', companyId, agentId] })
      toast('Retry triggered — new heartbeat started', 'success')
    },
    onError: (err: Error) => {
      toast(`Retry failed: ${err.message}`, 'error')
    },
  })

  if (runLoading) return <TranscriptSkeleton />
  if (runError) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load run: {(runError as Error).message}
      </div>
    )
  }
  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <Terminal className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Run not found</p>
      </div>
    )
  }

  const isFailed = run.status === 'failed'
  const isRunning = run.status === 'running'

  // Parse usage_json if available
  let usage: { provider?: string; model?: string; inputTokens?: number; outputTokens?: number; costCents?: number } | null = null
  if (run.usage_json) {
    try {
      usage = JSON.parse(run.usage_json)
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/agents/${agentId}`} aria-label="Back to agent">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Run Transcript</h2>
            <Badge
              variant={statusVariant[run.status] ?? 'secondary'}
              className="capitalize"
            >
              {run.status}
            </Badge>
            {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
          </div>
          <p className="text-sm text-muted-foreground">
            {agent?.name ?? 'Agent'} &middot; {run.trigger_type} trigger &middot; {formatRelativeTime(run.started_at)}
          </p>
        </div>
        {isFailed && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => wakeup.mutate()}
            disabled={wakeup.isPending}
          >
            {wakeup.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            {wakeup.isPending ? 'Retrying...' : 'Retry'}
          </Button>
        )}
      </div>

      {/* Metadata cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetadataCard label="Trigger">
          <span className="capitalize">{run.trigger_type}</span>
        </MetadataCard>
        <MetadataCard label="Duration">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDuration(run.started_at, run.finished_at)}
          </div>
        </MetadataCard>
        <MetadataCard label="Exit Code">
          <span className={cn(
            'font-mono',
            run.exit_code !== null && run.exit_code !== 0 && 'text-destructive',
          )}>
            {run.exit_code ?? (isRunning ? 'running...' : '—')}
          </span>
        </MetadataCard>
        <MetadataCard label="Started">
          {run.started_at ? formatDate(run.started_at) : '—'}
        </MetadataCard>
      </div>

      {/* Cost summary */}
      {usage && (
        <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          {usage.provider && <span className="text-muted-foreground">Provider: <strong className="text-foreground">{usage.provider}</strong></span>}
          {usage.model && <span className="text-muted-foreground">Model: <strong className="text-foreground">{usage.model}</strong></span>}
          {usage.inputTokens !== undefined && <span className="text-muted-foreground">Input: <strong className="text-foreground">{usage.inputTokens.toLocaleString()}</strong> tokens</span>}
          {usage.outputTokens !== undefined && <span className="text-muted-foreground">Output: <strong className="text-foreground">{usage.outputTokens.toLocaleString()}</strong> tokens</span>}
          {usage.costCents !== undefined && <span className="text-muted-foreground">Cost: <strong className="text-foreground">${(usage.costCents / 100).toFixed(4)}</strong></span>}
        </div>
      )}

      {/* Error banner */}
      {run.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">Error</span>
          </div>
          <pre className="overflow-auto text-xs font-mono whitespace-pre-wrap text-destructive/90">
            {redactPaths(run.error)}
          </pre>
        </div>
      )}

      {/* Stdout excerpt */}
      {run.stdout_excerpt && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4" />
              Agent Output
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[400px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap">
              {redactPaths(run.stdout_excerpt)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Event timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            Event Timeline
            {events && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {events.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-12 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : !events || events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No events recorded for this run.
            </p>
          ) : (
            <EventTimeline events={events} runStartedAt={run.started_at} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
