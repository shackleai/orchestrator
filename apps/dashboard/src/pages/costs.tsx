import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  fetchDashboard,
  fetchCostsByAgent,
  fetchCostEvents,
  fetchCompany,
  type DashboardData,
  type CostByAgent,
  type CostEvent,
  type Company,
} from '@/lib/api'
import { cn, formatCents, formatRelativeTime } from '@/lib/utils'

function useCompanyId() {
  const [params] = useSearchParams()
  return params.get('company') ?? 'default'
}

function BudgetGauge({
  spent,
  budget,
}: {
  spent: number
  budget: number
}) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Monthly budget</span>
        <span className="font-medium">
          {formatCents(spent)} / {formatCents(budget)}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct > 90
              ? 'bg-red-500'
              : pct > 70
                ? 'bg-amber-500'
                : 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Budget usage: ${pct.toFixed(0)}%`}
        />
      </div>
      <p className="text-xs text-muted-foreground text-right">
        {pct.toFixed(1)}% used
      </p>
    </div>
  )
}

function AgentCostBar({
  agentId,
  cost,
  maxCost,
}: {
  agentId: string | null
  cost: number
  maxCost: number
}) {
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-xs font-mono text-muted-foreground">
        {agentId ? agentId.slice(0, 8) : 'Unassigned'}
      </span>
      <div className="flex-1">
        <div className="h-5 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-amber transition-all"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-medium">
        {formatCents(cost)}
      </span>
    </div>
  )
}

interface DailySpend {
  date: string
  totalCents: number
}

function groupByDate(events: CostEvent[] | undefined): DailySpend[] {
  if (!events || events.length === 0) return []
  const map = new Map<string, number>()
  for (const ev of events) {
    const date = ev.occurred_at.slice(0, 10) // YYYY-MM-DD
    map.set(date, (map.get(date) ?? 0) + ev.cost_cents)
  }
  return Array.from(map.entries())
    .map(([date, totalCents]) => ({ date, totalCents }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14) // Last 14 days
}

function DailySpendChart({ events }: { events: CostEvent[] | undefined }) {
  const dailyData = groupByDate(events)
  if (dailyData.length === 0) return null

  const maxCost = Math.max(...dailyData.map((d) => d.totalCents), 1)
  const chartHeight = 160
  const barWidth = Math.max(12, Math.floor(600 / dailyData.length) - 4)
  const svgWidth = dailyData.length * (barWidth + 4) + 8

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily Spend Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <svg
            width={svgWidth}
            height={chartHeight + 32}
            viewBox={`0 0 ${svgWidth} ${chartHeight + 32}`}
            role="img"
            aria-label="Daily spend bar chart"
            className="min-w-full"
          >
            {dailyData.map((day, i) => {
              const barHeight = Math.max(
                (day.totalCents / maxCost) * chartHeight,
                2,
              )
              const x = i * (barWidth + 4) + 4
              const y = chartHeight - barHeight

              return (
                <g key={day.date}>
                  {/* Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={3}
                    className="fill-amber"
                  />
                  {/* Cost label on hover area */}
                  <title>
                    {day.date}: {formatCents(day.totalCents)}
                  </title>
                  {/* Date label */}
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={9}
                  >
                    {day.date.slice(5)} {/* MM-DD */}
                  </text>
                </g>
              )
            })}
            {/* Baseline */}
            <line
              x1={0}
              y1={chartHeight}
              x2={svgWidth}
              y2={chartHeight}
              className="stroke-border"
              strokeWidth={1}
            />
          </svg>
        </div>
      </CardContent>
    </Card>
  )
}

function CostsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-20 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function CostsPage() {
  const companyId = useCompanyId()

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard', companyId],
    queryFn: () => fetchDashboard(companyId),
  })

  const { data: company } = useQuery<Company>({
    queryKey: ['company', companyId],
    queryFn: () => fetchCompany(companyId),
  })

  const { data: byAgent, isLoading: agentLoading } = useQuery<CostByAgent[]>({
    queryKey: ['costs-by-agent', companyId],
    queryFn: () => fetchCostsByAgent(companyId),
  })

  const { data: events, isLoading: eventsLoading } = useQuery<CostEvent[]>({
    queryKey: ['cost-events', companyId],
    queryFn: () => fetchCostEvents(companyId),
  })

  const isLoading = dashLoading || agentLoading || eventsLoading

  if (isLoading) return <CostsSkeleton />

  const totalSpend = dashboard?.totalSpendCents ?? 0
  const budget = company?.budget_monthly_cents ?? 0
  const spent = company?.spent_monthly_cents ?? totalSpend
  const maxAgentCost = byAgent
    ? Math.max(...byAgent.map((a) => a.total_cost_cents), 1)
    : 1

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Costs</h2>

      {/* Summary + Budget */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Monthly Spend
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCents(totalSpend)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Budget Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {budget > 0 ? (
              <BudgetGauge spent={spent} budget={budget} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No budget configured
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost by Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost by Agent</CardTitle>
        </CardHeader>
        <CardContent>
          {!byAgent || byAgent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No cost data yet
            </p>
          ) : (
            <div className="space-y-3">
              {byAgent.map((entry, i) => (
                <AgentCostBar
                  key={entry.agent_id ?? `unassigned-${i}`}
                  agentId={entry.agent_id}
                  cost={entry.total_cost_cents}
                  maxCost={maxAgentCost}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Spend Trend */}
      <DailySpendChart events={events} />

      {/* Recent Cost Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Cost Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!events || events.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No cost events recorded
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="hidden sm:table-cell">Model</TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Input Tokens
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Output Tokens
                  </TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="hidden sm:table-cell">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {ev.provider ?? 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {ev.model ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right font-mono text-xs">
                      {ev.input_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right font-mono text-xs">
                      {ev.output_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatCents(ev.cost_cents)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {formatRelativeTime(ev.occurred_at)}
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
