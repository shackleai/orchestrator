import { useQuery } from '@tanstack/react-query'
import { useCompanyId } from '@/hooks/useCompanyId'
import { Network } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchAgents, type Agent } from '@/lib/api'

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success',
  idle: 'secondary',
  paused: 'warning',
  error: 'destructive',
  terminated: 'destructive',
}

interface TreeNode {
  agent: Agent
  children: TreeNode[]
}

function buildTree(agents: Agent[]): TreeNode[] {
  const agentMap = new Map<string, Agent>()

  for (const agent of agents) {
    agentMap.set(agent.id, agent)
  }

  // Collect children for each parent
  const roots: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  for (const agent of agents) {
    const node: TreeNode = { agent, children: [] }
    nodeMap.set(agent.id, node)
  }

  for (const agent of agents) {
    const node = nodeMap.get(agent.id)!
    if (agent.reports_to && nodeMap.has(agent.reports_to)) {
      nodeMap.get(agent.reports_to)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function OrgChartSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-28 animate-pulse rounded bg-muted" />
      <div className="flex justify-center">
        <div className="space-y-6">
          <div className="mx-auto h-20 w-48 animate-pulse rounded bg-muted" />
          <div className="flex gap-6 justify-center">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 w-40 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function OrgChartEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Network className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No agents yet</p>
      <p className="text-xs text-muted-foreground">
        Create agents with reporting relationships to see the org chart.
      </p>
    </div>
  )
}

function AgentNode({ agent }: { agent: Agent }) {
  return (
    <Card className="w-44 transition-colors hover:border-amber/40">
      <CardContent className="p-3 text-center space-y-1.5">
        <p className="text-sm font-semibold truncate">{agent.name}</p>
        {agent.role && (
          <p className="text-[11px] text-muted-foreground truncate">
            {agent.role}
          </p>
        )}
        <Badge
          variant={statusVariant[agent.status] ?? 'secondary'}
          className="capitalize text-[10px]"
        >
          {agent.status}
        </Badge>
      </CardContent>
    </Card>
  )
}

function TreeLevel({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return null

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-wrap justify-center gap-6">
        {nodes.map((node) => (
          <div key={node.agent.id} className="flex flex-col items-center">
            {/* Connector line from parent */}
            <div className="relative flex flex-col items-center">
              <AgentNode agent={node.agent} />

              {/* Vertical line down to children */}
              {node.children.length > 0 && (
                <div className="mt-2 flex flex-col items-center">
                  <div className="h-4 w-px bg-border" />

                  {/* Horizontal connector across children */}
                  {node.children.length > 1 && (
                    <div className="h-px self-stretch bg-border" style={{
                      width: `calc(${(node.children.length - 1) * 100}% + ${(node.children.length - 1) * 24}px)`,
                      maxWidth: `${node.children.length * 11}rem`,
                    }} />
                  )}

                  {/* Recurse into children */}
                  <div className="flex flex-wrap justify-center gap-6 pt-2">
                    {node.children.map((child) => (
                      <div key={child.agent.id} className="flex flex-col items-center">
                        <div className="h-4 w-px bg-border" />
                        <TreeLevel nodes={[child]} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OrgChartPage() {
  const companyId = useCompanyId()

  const {
    data: agents,
    isLoading,
    error,
  } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
  })

  if (isLoading) return <OrgChartSkeleton />
  if (error) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load agents: {(error as Error).message}
      </div>
    )
  }
  if (!agents || agents.length === 0) return <OrgChartEmpty />

  const tree = buildTree(agents)

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Org Chart</h2>
      <div className="overflow-x-auto pb-4">
        <div className="min-w-fit px-4">
          <TreeLevel nodes={tree} />
        </div>
      </div>
    </div>
  )
}
