import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from '@/hooks/usePolling'
import { ListTodo, Plus, Loader2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import {
  fetchTasks,
  fetchAgents,
  createTask,
  type Issue,
  type Agent,
  type CreateTaskPayload,
} from '@/lib/api'
import { Pagination } from '@/components/ui/pagination'
import { usePagination } from '@/hooks/usePagination'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'


const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

const priorityOptions = [
  { value: '', label: 'All priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const statusVariant: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  backlog: 'secondary',
  todo: 'secondary',
  in_progress: 'info',
  in_review: 'warning',
  done: 'success',
  cancelled: 'destructive',
}

const priorityVariant: Record<string, 'destructive' | 'warning' | 'secondary' | 'info'> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'secondary',
  low: 'secondary',
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function TasksSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TasksEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <ListTodo className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No tasks found</p>
      <p className="text-xs text-muted-foreground">
        Tasks will appear here when agents create or receive them.
      </p>
    </div>
  )
}

function CreateTaskForm({
  companyId,
  onClose,
}: {
  companyId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId),
    enabled: !!companyId,
  })

  const mutation = useMutation({
    mutationFn: (payload: CreateTaskPayload) => createTask(companyId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', companyId] })
      toast('Task created', 'success')
      onClose()
    },
    onError: (err: Error) => {
      toast(`Failed to create task: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    mutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      assignee_agent_id: assigneeAgentId || null,
      status: 'todo',
    })
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement user authentication"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task..."
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="task-priority" className="text-sm font-medium">
                Priority
              </label>
              <Select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="task-assignee" className="text-sm font-medium">
                Assign to
              </label>
              <Select
                id="task-assignee"
                value={assigneeAgentId}
                onChange={(e) => setAssigneeAgentId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {agents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !title.trim()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function TasksPage() {
  const companyId = useCompanyId()
  const tasksInterval = usePollingInterval(POLLING_INTERVALS.tasks)
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const { page, perPage, offset, setPage, setPerPage, resetPage } = usePagination({ defaultPerPage: 25 })

  // Reset to page 0 when filters change
  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    resetPage()
  }
  const handlePriorityChange = (value: string) => {
    setPriorityFilter(value)
    resetPage()
  }

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  })

  const agentMap = new Map(agents?.map((a) => [a.id, a.name]) ?? [])

  const { data: rawTasks, isLoading, error } = useQuery<Issue[]>({
    queryKey: ['tasks', companyId, statusFilter, priorityFilter, page, perPage],
    queryFn: () =>
      fetchTasks(
        companyId!,
        {
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
        },
        {
          limit: perPage + 1,
          offset,
        },
      ),
    enabled: !!companyId,
    refetchInterval: tasksInterval,
  })

  const hasMore = (rawTasks?.length ?? 0) > perPage
  const tasks = rawTasks ? rawTasks.slice(0, perPage) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="w-40"
            aria-label="Filter by status"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select
            value={priorityFilter}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className="w-40"
            aria-label="Filter by priority"
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setShowCreate(true)} disabled={!companyId}>
            <Plus className="h-4 w-4" />
            Create Task
          </Button>
        </div>
      </div>

      {showCreate && companyId && (
        <CreateTaskForm
          companyId={companyId}
          onClose={() => setShowCreate(false)}
        />
      )}

      {isLoading ? (
        <TasksSkeleton />
      ) : error ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Failed to load tasks: {(error as Error).message}
        </div>
      ) : !tasks || tasks.length === 0 ? (
        page === 0 ? (
          <TasksEmpty />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No more tasks to display.
          </div>
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Priority</TableHead>
                  <TableHead className="hidden md:table-cell">Assignee</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tasks/${task.id}`)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {task.identifier}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate font-medium">
                      {task.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant[task.status] ?? 'secondary'}
                        className="capitalize"
                      >
                        {statusLabel(task.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant={priorityVariant[task.priority] ?? 'secondary'}
                        className="capitalize"
                      >
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {task.assignee_agent_id
                        ? agentMap.get(task.assignee_agent_id) ?? 'Unassigned'
                        : 'Unassigned'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatDate(task.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
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
