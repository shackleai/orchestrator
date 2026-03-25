import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Terminal,
  AlertTriangle,
  MessageSquare,
  Bot,
  Wrench,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchHeartbeatRun,
  fetchHeartbeatRunEvents,
  fetchAgent,
  type HeartbeatRun,
  type HeartbeatRunEvent,
  type Agent,
} from '@/lib/api'
import {
  cn,
  formatCents,
  formatDate,
  formatDuration,
  formatRelativeTime,
  redactPaths,
} from '@/lib/utils'

const statusVariant: Record<
  string,
  'success' | 'warning' | 'destructive' | 'secondary' | 'info'
> = {
  success: 'success',
  running: 'info',
  failed: 'destructive',
  skipped: 'secondary',
}

interface ParsedUsage {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  error_category?: string
  error_message?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls?: Array<{ name: string; input?: any; output?: any }>
}

function parseUsageJson(usageJson: string | null): ParsedUsage | null {
  if (!usageJson) return null
  try {
    return JSON.parse(usageJson) as ParsedUsage
  } catch {
    return null
  }
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

function MetadataCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function ErrorCategoryBanner({
  category,
  message,
}: {
  category: string
  message?: string
}) {
  const categoryLabels: Record<string, { label: string; hint: string }> = {
    auth: {
      label: 'Authentication Error',
      hint: 'Check your API keys in Settings.',
    },
    rate_limit: {
      label: 'Rate Limited',
      hint: 'The provider rate-limited this request. Try again later.',
    },
    budget: {
      label: 'Budget Exceeded',
      hint: 'This agent has exceeded its monthly budget.',
    },
    timeout: {
      label: 'Timeout',
      hint: 'The agent took too long to respond.',
    },
    adapter: {
      label: 'Adapter Error',
      hint: 'The agent adapter encountered an error.',
    },
  }

  const info = categoryLabels[category] ?? {
    label: category,
    hint: 'An unexpected error occurred.',
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="text-sm font-semibold text-destructive">
          {info.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{info.hint}</p>
      {message && (
        <pre className="mt-2 overflow-auto rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs font-mono whitespace-pre-wrap text-destructive/90">
          {redactPaths(message)}
        </pre>
      )}
    </div>
  )
}

function ToolCallCard({
  call,
  index,
}: {
  call: { name: string; input?: unknown; output?: unknown }
  index: number
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
        aria-expanded={expanded}
        aria-label={`Toggle tool call ${call.name} details`}
      >
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{call.name}</span>
        <Badge variant="outline" className="text-[10px] font-mono">
          #{index + 1}
        </Badge>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="space-y-3 border-t px-4 py-3">
          {call.input !== undefined && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Input
              </p>
              <pre className="max-h-[200px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">
                {typeof call.input === 'string'
                  ? redactPaths(call.input)
                  : redactPaths(JSON.stringify(call.input, null, 2))}
              </pre>
            </div>
          )}
          {call.output !== undefined && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
                Output
              </p>
              <pre className="max-h-[200px] overflow-auto rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-mono whitespace-pre-wrap">
                {typeof call.output === 'string'
                  ? redactPaths(call.output)
                  : redactPaths(JSON.stringify(call.output, null, 2))}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StdoutPanel({ content }: { content: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="h-4 w-4" />
          Agent Output
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[500px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap">
          {redactPaths(content)}
        </pre>
      </CardContent>
    </Card>
  )
}

function StderrPanel({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-label="Toggle stderr panel"
        >
          <CardTitle className="flex items-center gap-2 text-base text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            Stderr
          </CardTitle>
          {expanded ? (
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          <pre className="max-h-[300px] overflow-auto rounded-md border border-amber-500/20 bg-amber-500/5 p-4 text-xs font-mono whitespace-pre-wrap">
            {redactPaths(content)}
          </pre>
        </CardContent>
      )}
    </Card>
  )
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams] = useSearchParams()
  const agentId = searchParams.get('agent')
  const companyId = useCompanyId()
  const pollingInterval = usePollingInterval(POLLING_INTERVALS.agents)

  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useQuery<HeartbeatRun>({
    queryKey: ['heartbeat-run', companyId, sessionId],
    queryFn: () => fetchHeartbeatRun(companyId!, sessionId!),
    enabled: !!companyId && !!sessionId,
    refetchInterval: pollingInterval,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<
    HeartbeatRunEvent[]
  >({
    queryKey: ['heartbeat-run-events', companyId, sessionId],
    queryFn: () => fetchHeartbeatRunEvents(companyId!, sessionId!),
    enabled: !!companyId && !!sessionId,
    refetchInterval: pollingInterval,
  })

  const { data: agent } = useQuery<Agent>({
    queryKey: ['agent', companyId, agentId],
    queryFn: () => fetchAgent(companyId!, agentId!),
    enabled: !!companyId && !!agentId,
    staleTime: 30_000,
  })

  if (runLoading) return <DetailSkeleton />
  if (runError) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load session: {(runError as Error).message}
      </div>
    )
  }
  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <MessageSquare className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Session not found</p>
      </div>
    )
  }

  const isRunning = run.status === 'running'
  const usage = parseUsageJson(run.usage_json)

  // Extract stderr from events if present
  const stderrContent = events
    ?.filter(
      (e) =>
        e.payload &&
        typeof (e.payload as Record<string, unknown>).stderr === 'string',
    )
    .map((e) => (e.payload as Record<string, string>).stderr)
    .filter(Boolean)
    .join('\n')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/sessions" aria-label="Back to sessions">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Session Detail</h2>
            <Badge
              variant={statusVariant[run.status] ?? 'secondary'}
              className="capitalize"
            >
              {run.status}
            </Badge>
            {isRunning && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {agent?.name ?? 'Agent'} &middot; {run.trigger_type} trigger &middot;{' '}
            {formatRelativeTime(run.started_at)}
          </p>
        </div>
      </div>

      {/* Agent info */}
      {agent && (
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">{agent.name}</p>
            {agent.title && (
              <p className="text-xs text-muted-foreground">{agent.title}</p>
            )}
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {agent.adapter_type}
          </Badge>
        </div>
      )}

      {/* Metadata grid */}
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
        <MetadataCard label="Started">
          {run.started_at ? formatDate(run.started_at) : '--'}
        </MetadataCard>
        <MetadataCard label="Exit Code">
          <span
            className={cn(
              'font-mono',
              run.exit_code !== null &&
                run.exit_code !== 0 &&
                'text-destructive',
            )}
          >
            {run.exit_code ?? (isRunning ? 'running...' : '--')}
          </span>
        </MetadataCard>
      </div>

      {/* Token usage breakdown */}
      {usage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Token Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 text-sm">
              {usage.provider && (
                <div>
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="font-medium">{usage.provider}</p>
                </div>
              )}
              {usage.model && (
                <div>
                  <p className="text-xs text-muted-foreground">Model</p>
                  <p className="font-medium">{usage.model}</p>
                </div>
              )}
              {usage.inputTokens !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Input Tokens</p>
                  <p className="font-medium font-mono">
                    {usage.inputTokens.toLocaleString()}
                  </p>
                </div>
              )}
              {usage.outputTokens !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Output Tokens</p>
                  <p className="font-medium font-mono">
                    {usage.outputTokens.toLocaleString()}
                  </p>
                </div>
              )}
              {usage.inputTokens !== undefined &&
                usage.outputTokens !== undefined && (
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-medium font-mono">
                      {(
                        usage.inputTokens + usage.outputTokens
                      ).toLocaleString()}
                    </p>
                  </div>
                )}
              {usage.costCents !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Cost</p>
                  <p className="font-medium">{formatCents(usage.costCents)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error category banner (from #336) */}
      {usage?.error_category && (
        <ErrorCategoryBanner
          category={usage.error_category}
          message={usage.error_message ?? run.error ?? undefined}
        />
      )}

      {/* Generic error banner */}
      {run.error && !usage?.error_category && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">
              Error
            </span>
          </div>
          <pre className="overflow-auto text-xs font-mono whitespace-pre-wrap text-destructive/90">
            {redactPaths(run.error)}
          </pre>
        </div>
      )}

      {/* Stdout panel */}
      {run.stdout_excerpt && <StdoutPanel content={run.stdout_excerpt} />}

      {/* Stderr panel (collapsible, only if non-empty) */}
      {stderrContent && <StderrPanel content={stderrContent} />}

      {/* Tool calls */}
      {usage?.toolCalls && usage.toolCalls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" />
              Tool Calls
              <Badge
                variant="secondary"
                className="ml-1 px-1.5 py-0 text-[10px]"
              >
                {usage.toolCalls.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {usage.toolCalls.map((call, i) => (
              <ToolCallCard key={i} call={call} index={i} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Events (loading) */}
      {eventsLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Events timeline (compact) */}
      {events && events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Events
              <Badge
                variant="secondary"
                className="ml-1 px-1.5 py-0 text-[10px]"
              >
                {events.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" role="list">
              {events.map((event) => {
                const runStart = run.started_at
                  ? new Date(run.started_at).getTime()
                  : null
                const eventTime = new Date(event.created_at).getTime()
                const relativeMs = runStart ? eventTime - runStart : null
                const relativeLabel =
                  relativeMs !== null && relativeMs >= 0
                    ? relativeMs < 1000
                      ? `+${relativeMs}ms`
                      : `+${(relativeMs / 1000).toFixed(1)}s`
                    : null

                return (
                  <li
                    key={event.id}
                    className="flex items-center gap-3 rounded-lg border px-4 py-2"
                  >
                    <span className="text-sm font-medium">
                      {event.event_type
                        .split('_')
                        .map(
                          (w) => w.charAt(0).toUpperCase() + w.slice(1),
                        )
                        .join(' ')}
                    </span>
                    {relativeLabel && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {relativeLabel}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatRelativeTime(event.created_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
