import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import {
  Bot,
  ListTodo,
  CircleDot,
  CheckCircle2,
  DollarSign,
  Activity,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchDashboard, fetchAgents, type DashboardData, type Agent } from '@/lib/api'
import { formatCents, formatRelativeTime } from '@/lib/utils'
import { OnboardingWizard } from '@/components/onboarding'

function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  href?: string
}) {
  const content = (
    <Card className={href ? 'transition-colors hover:border-primary/50 hover:bg-muted/50' : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  )

  if (href) {
    return (
      <Link to={href} className="no-underline">
        {content}
      </Link>
    )
  }

  return content
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded bg-muted"
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function OverviewError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Activity className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Failed to load dashboard data
      </p>
      <p className="text-xs text-destructive-foreground">{message}</p>
    </div>
  )
}

function OverviewEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Bot className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        No data yet. Create your first agent to get started.
      </p>
    </div>
  )
}

export function OverviewPage() {
  const companyId = useCompanyId()
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', companyId],
    queryFn: () => fetchDashboard(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  })

  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  })

  const isFirstTime = !agentsLoading && agents !== undefined && agents.length === 0

  if (isLoading || agentsLoading) return <OverviewSkeleton />
  if (error) return <OverviewError message={(error as Error).message} />
  if (isFirstTime && companyId) return <OnboardingWizard companyId={companyId} />
  if (!data) return <OverviewEmpty />

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Agents" value={data.agentCount} icon={Bot} href="/agents" />
        <StatCard label="Total Tasks" value={data.taskCount} icon={ListTodo} href="/tasks" />
        <StatCard label="Open Tasks" value={data.openTasks} icon={CircleDot} href="/tasks" />
        <StatCard
          label="Completed"
          value={data.completedTasks}
          icon={CheckCircle2}
          href="/tasks"
        />
        <StatCard
          label="Total Spend"
          value={formatCents(data.totalSpendCents)}
          icon={DollarSign}
          href="/costs"
        />
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No recent activity
            </p>
          ) : (
            <ul className="space-y-3" role="list">
              {data.recentActivity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="capitalize">
                      {entry.entity_type}
                    </Badge>
                    <span className="text-sm">
                      <span className="font-medium capitalize">
                        {entry.action}
                      </span>
                      {entry.entity_id && (
                        <span className="text-muted-foreground">
                          {' '}
                          on {entry.entity_id.slice(0, 8)}
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
