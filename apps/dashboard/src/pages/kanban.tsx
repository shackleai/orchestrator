import { useState, type DragEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { useToast } from '@/components/ui/toast'
import { LayoutGrid } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchTasks, fetchAgents, updateIssue, type Issue, type Agent } from '@/lib/api'

const COLUMNS = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
] as const

const priorityVariant: Record<string, 'destructive' | 'warning' | 'secondary' | 'info'> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'secondary',
  low: 'secondary',
}

const priorityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function KanbanSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-5 w-20 animate-pulse rounded bg-muted" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-24 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function KanbanEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <LayoutGrid className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No tasks to display</p>
      <p className="text-xs text-muted-foreground">
        Tasks will appear on the board when agents create or receive them.
      </p>
    </div>
  )
}

function KanbanCard({
  task,
  agentMap,
  onClick,
}: {
  task: Issue
  agentMap: Map<string, string>
  onClick: () => void
}) {
  const assigneeName = task.assignee_agent_id
    ? agentMap.get(task.assignee_agent_id) ?? task.assignee_agent_id.slice(0, 8)
    : null

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('application/x-task-id', task.id)
    e.dataTransfer.setData('application/x-task-status', task.status)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      className="cursor-grab active:cursor-grabbing transition-colors hover:border-amber/40"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {task.identifier}
          </span>
          <Badge
            variant={priorityVariant[task.priority] ?? 'secondary'}
            className="capitalize text-[10px] px-1.5 py-0"
          >
            {task.priority}
          </Badge>
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {task.title}
        </p>
        {assigneeName && (
          <p className="text-[11px] text-muted-foreground truncate">
            {assigneeName}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const COLUMN_LABELS: Record<string, string> = {}
for (const col of COLUMNS) {
  COLUMN_LABELS[col.key] = col.label
}

export function KanbanPage() {
  const companyId = useCompanyId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery<Issue[]>({
    queryKey: ['tasks', companyId],
    queryFn: () => fetchTasks(companyId!),
    enabled: !!companyId,
  })

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
  })

  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      updateIssue(companyId!, taskId, { status }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', companyId] })
      const label = COLUMN_LABELS[variables.status] ?? variables.status
      toast(`Task moved to ${label}`, 'success')
    },
    onError: (err: Error) => {
      toast(`Failed to move task: ${err.message}`, 'error')
    },
  })

  if (tasksLoading) return <KanbanSkeleton />
  if (tasksError) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load tasks: {(tasksError as Error).message}
      </div>
    )
  }
  if (!tasks || tasks.length === 0) return <KanbanEmpty />

  // Build agent name lookup
  const agentMap = new Map<string, string>()
  if (agents) {
    for (const agent of agents) {
      agentMap.set(agent.id, agent.name)
    }
  }

  // Group tasks by status column
  const grouped: Record<string, Issue[]> = {}
  for (const col of COLUMNS) {
    grouped[col.key] = []
  }
  for (const task of tasks) {
    const col = grouped[task.status]
    if (col) {
      col.push(task)
    }
  }

  // Sort each column by priority
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(
      (a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99),
    )
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, columnKey: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnKey)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>, columnKey: string) {
    // Only clear if we're leaving the column itself, not entering a child
    const relatedTarget = e.relatedTarget as Node | null
    if (!e.currentTarget.contains(relatedTarget)) {
      if (dragOverColumn === columnKey) {
        setDragOverColumn(null)
      }
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, targetStatus: string) {
    e.preventDefault()
    setDragOverColumn(null)

    const taskId = e.dataTransfer.getData('application/x-task-id')
    const sourceStatus = e.dataTransfer.getData('application/x-task-status')

    if (!taskId || sourceStatus === targetStatus) return

    moveTask.mutate({ taskId, status: targetStatus })
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Board</h2>

      {/* Desktop: horizontal columns. Mobile: stacked. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const columnTasks = grouped[col.key]
          const isDragTarget = dragOverColumn === col.key
          return (
            <div
              key={col.key}
              className={`min-w-0 rounded-lg border-2 p-2 transition-colors duration-150 ${
                isDragTarget
                  ? 'border-blue-500/60 bg-blue-500/5'
                  : 'border-transparent'
              }`}
              onDragOver={(e) => handleDragOver(e, col.key)}
              onDragLeave={(e) => handleDragLeave(e, col.key)}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {columnTasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {columnTasks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No tasks
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      agentMap={agentMap}
                      onClick={() => navigate(`/tasks/${task.id}`)}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
