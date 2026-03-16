import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Bot, Activity } from 'lucide-react'
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
import { fetchAgent, fetchHeartbeats, type Agent, type HeartbeatRun } from '@/lib/api'
import { cn, formatCents, formatDate, formatRelativeTime } from '@/lib/utils'

function useCompanyId() {
  const [params] = useSearchParams()
  return params.get('company') ?? 'default'
}

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

export function AgentDetailPage() {
  const { id: agentId } = useParams<{ id: string }>()
  const companyId = useCompanyId()

  const {
    data: agent,
    isLoading: agentLoading,
    error: agentError,
  } = useQuery<Agent>({
    queryKey: ['agent', companyId, agentId],
    queryFn: () => fetchAgent(companyId, agentId!),
    enabled: !!agentId,
  })

  const { data: heartbeats, isLoading: heartbeatsLoading } = useQuery<HeartbeatRun[]>({
    queryKey: ['heartbeats', companyId, agentId],
    queryFn: () => fetchHeartbeats(companyId, agentId!),
    enabled: !!agentId,
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
        <div>
          <h2 className="text-lg font-semibold">{agent.name}</h2>
          {agent.title && (
            <p className="text-sm text-muted-foreground">{agent.title}</p>
          )}
        </div>
      </div>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Started</TableHead>
                  <TableHead className="hidden md:table-cell">Finished</TableHead>
                  <TableHead className="hidden md:table-cell">Exit Code</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heartbeats.map((hb) => (
                  <TableRow key={hb.id}>
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
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatRelativeTime(hb.finished_at)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs">
                      {hb.exit_code ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-destructive-foreground">
                      {hb.error ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
