import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ListTodo } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { fetchTasks, type Issue } from '@/lib/api'
import { formatDate } from '@/lib/utils'

function useCompanyId() {
  const [params] = useSearchParams()
  return params.get('company') ?? 'default'
}

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

export function TasksPage() {
  const companyId = useCompanyId()
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  const { data: tasks, isLoading, error } = useQuery<Issue[]>({
    queryKey: ['tasks', companyId, statusFilter, priorityFilter],
    queryFn: () =>
      fetchTasks(companyId, {
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
      }),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-40"
            aria-label="Filter by priority"
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <TasksSkeleton />
      ) : error ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Failed to load tasks: {(error as Error).message}
        </div>
      ) : !tasks || tasks.length === 0 ? (
        <TasksEmpty />
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
                  <TableRow key={task.id}>
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
                        ? task.assignee_agent_id.slice(0, 8)
                        : 'Unassigned'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatDate(task.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
