import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { Bot } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { fetchAgents, type Agent } from '@/lib/api'
import { cn, formatCents, formatRelativeTime } from '@/lib/utils'

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  active: 'success',
  idle: 'secondary',
  paused: 'warning',
  error: 'destructive',
  terminated: 'destructive',
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

function AgentsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Bot className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No agents yet</p>
      <p className="text-xs text-muted-foreground">
        Create an agent to get started with orchestration.
      </p>
    </div>
  )
}

export function AgentsPage() {
  const companyId = useCompanyId()
  const navigate = useNavigate()
  const { data: agents, isLoading, error } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
  })

  if (isLoading) return <AgentsSkeleton />
  if (error) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load agents: {(error as Error).message}
      </div>
    )
  }

  if (!agents || agents.length === 0) return <AgentsEmpty />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agents</h2>
        <span className="text-sm text-muted-foreground">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </div>

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
                <TableHead className="hidden md:table-cell">Last Heartbeat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
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
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {formatRelativeTime(agent.last_heartbeat_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
