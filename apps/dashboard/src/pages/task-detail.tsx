import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useCompanyId } from '@/hooks/useCompanyId'
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  ListTodo,
  Loader2,
  MessageSquare,
  Pencil,
  Reply,
  Send,
  Clock,
  Tag,
  Trash2,
  GitBranch,
  User,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchIssue,
  fetchTasks,
  fetchComments,
  fetchAgents,
  fetchActivity,
  fetchIssueLabels,
  createComment,
  updateComment,
  deleteComment,
  updateIssue,
  type Issue,
  type Comment,
  type Agent,
  type Label,
  type ActivityLogEntry,
} from '@/lib/api'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted" />
          ))}
        </div>
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

// ---------------------------------------------------------------------------
// Threaded comments
// ---------------------------------------------------------------------------

interface CommentNode extends Comment {
  children: CommentNode[]
}

function buildCommentTree(comments: Comment[]): CommentNode[] {
  const map = new Map<string, CommentNode>()
  const roots: CommentNode[] = []

  // Sort ascending so parents are processed before children
  const sorted = [...comments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  for (const c of sorted) {
    map.set(c.id, { ...c, children: [] })
  }

  for (const c of sorted) {
    const node = map.get(c.id)!
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function CommentAuthor({
  agentId,
  agentMap,
}: {
  agentId: string | null
  agentMap: Map<string, Agent>
}) {
  if (!agentId) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        User
      </span>
    )
  }

  const agent = agentMap.get(agentId)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <Bot className="h-3.5 w-3.5 text-primary" />
      {agent ? agent.name : `Agent ${agentId.slice(0, 8)}`}
    </span>
  )
}

function ThreadedCommentItem({
  comment,
  companyId,
  issueId,
  agentMap,
  depth,
}: {
  comment: CommentNode
  companyId: string
  issueId: string
  agentMap: Map<string, Agent>
  depth: number
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(comment.content)
  const [isReplying, setIsReplying] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showActions, setShowActions] = useState(false)

  const invalidateComments = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', companyId, issueId] })
  }

  const resolveMutation = useMutation({
    mutationFn: () =>
      updateComment(companyId, issueId, comment.id, {
        is_resolved: !comment.is_resolved,
      }),
    onSuccess: () => {
      invalidateComments()
      toast(comment.is_resolved ? 'Comment unresolved' : 'Comment resolved', 'success')
    },
    onError: (err: Error) => toast(`Failed: ${err.message}`, 'error'),
  })

  const editMutation = useMutation({
    mutationFn: (content: string) =>
      updateComment(companyId, issueId, comment.id, { content }),
    onSuccess: () => {
      invalidateComments()
      setIsEditing(false)
      toast('Comment updated', 'success')
    },
    onError: (err: Error) => toast(`Failed: ${err.message}`, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteComment(companyId, issueId, comment.id),
    onSuccess: () => {
      invalidateComments()
      toast('Comment deleted', 'success')
    },
    onError: (err: Error) => toast(`Failed: ${err.message}`, 'error'),
  })

  const handleEditSave = () => {
    const trimmed = editDraft.trim()
    if (!trimmed) return
    if (trimmed === comment.content) {
      setIsEditing(false)
      return
    }
    editMutation.mutate(trimmed)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditDraft(comment.content)
      setIsEditing(false)
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleEditSave()
    }
  }

  return (
    <div className={depth > 0 ? 'ml-6 border-l-2 border-border pl-4' : ''}>
      <div
        className={`group py-3 ${comment.is_resolved ? 'opacity-60' : ''}`}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => {
          setShowActions(false)
          setShowDeleteConfirm(false)
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <CommentAuthor agentId={comment.author_agent_id} agentMap={agentMap} />
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelativeTime(comment.created_at)}
            </span>
            {comment.is_resolved && (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">
                Resolved
              </Badge>
            )}
          </div>

          {/* Action buttons -- visible on hover */}
          <div
            className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
              showActions ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsReplying(!isReplying)}
              title="Reply"
              aria-label="Reply to comment"
            >
              <Reply className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => resolveMutation.mutate()}
              disabled={resolveMutation.isPending}
              title={comment.is_resolved ? 'Unresolve' : 'Resolve'}
              aria-label={comment.is_resolved ? 'Unresolve comment' : 'Resolve comment'}
            >
              {resolveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : comment.is_resolved ? (
                <Circle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setEditDraft(comment.content)
                setIsEditing(true)
              }}
              title="Edit"
              aria-label="Edit comment"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {showDeleteConfirm ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Confirm'
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Body -- editable or static */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              disabled={editMutation.isPending}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7"
                onClick={handleEditSave}
                disabled={editMutation.isPending || !editDraft.trim()}
              >
                {editMutation.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Check className="mr-1 h-3 w-3" />
                )}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => {
                  setEditDraft(comment.content)
                  setIsEditing(false)
                }}
              >
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto hidden sm:inline">
                Ctrl+Enter to save
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
        )}
      </div>

      {/* Reply form */}
      {isReplying && (
        <div className="ml-6 border-l-2 border-primary/30 pl-4 pb-2">
          <AddCommentForm
            companyId={companyId}
            issueId={issueId}
            parentId={comment.id}
            placeholder={`Reply to ${
              comment.author_agent_id
                ? agentMap.get(comment.author_agent_id)?.name ?? 'agent'
                : 'user'
            }...`}
            onSuccess={() => setIsReplying(false)}
            onCancel={() => setIsReplying(false)}
            autoFocus
          />
        </div>
      )}

      {/* Child comments */}
      {comment.children.length > 0 && (
        <div>
          {comment.children.map((child) => (
            <ThreadedCommentItem
              key={child.id}
              comment={child}
              companyId={companyId}
              issueId={issueId}
              agentMap={agentMap}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AddCommentForm({
  companyId,
  issueId,
  parentId,
  placeholder,
  onSuccess,
  onCancel,
  autoFocus,
}: {
  companyId: string
  issueId: string
  parentId?: string | null
  placeholder?: string
  onSuccess?: () => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [body, setBody] = useState('')

  const mutation = useMutation({
    mutationFn: (text: string) => createComment(companyId, issueId, text, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', companyId, issueId] })
      setBody('')
      toast('Comment added', 'success')
      onSuccess?.()
    },
    onError: (err: Error) => {
      toast(`Failed to add comment: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    mutation.mutate(body.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (body.trim()) mutation.mutate(body.trim())
    }
    if (e.key === 'Escape' && onCancel) {
      onCancel()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Add a comment...'}
        rows={2}
        className="flex flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
        autoFocus={autoFocus}
      />
      <div className="flex flex-col gap-1 self-end">
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending || !body.trim()}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-xs"
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Editable fields
// ---------------------------------------------------------------------------

function EditableTitle({
  value,
  onSave,
  isPending,
}: {
  value: string
  onSave: (title: string) => void
  isPending: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const handleSave = () => {
    if (draft.trim() && draft.trim() !== value) {
      onSave(draft.trim())
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        className="text-lg font-semibold"
        autoFocus
      />
    )
  }

  return (
    <h2
      className="text-lg font-semibold cursor-pointer hover:text-muted-foreground transition-colors"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title="Click to edit title"
    >
      {value}
    </h2>
  )
}

function EditableDescription({
  value,
  onSave,
  isPending,
}: {
  value: string | null
  onSave: (description: string) => void
  isPending: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const handleSave = () => {
    if (draft !== (value ?? '')) {
      onSave(draft)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          rows={5}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(value ?? '')
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="cursor-pointer rounded-md border border-transparent p-2 text-sm hover:border-border transition-colors min-h-[60px]"
      onClick={() => {
        setDraft(value ?? '')
        setEditing(true)
      }}
      title="Click to edit description"
    >
      {value ? (
        <p className="whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-muted-foreground italic">No description. Click to add one.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const statusVariant: Record<
  string,
  'success' | 'warning' | 'destructive' | 'secondary' | 'info'
> = {
  backlog: 'secondary',
  todo: 'secondary',
  in_progress: 'info',
  in_review: 'warning',
  done: 'success',
  cancelled: 'destructive',
}

const priorityVariant: Record<
  string,
  'destructive' | 'warning' | 'secondary'
> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'secondary',
  low: 'secondary',
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function ActivityItem({ entry }: { entry: ActivityLogEntry }) {
  const changesSummary = entry.changes
    ? Object.keys(entry.changes).join(', ')
    : null

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-b-0">
      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium capitalize">{entry.action}</span>
          {' '}
          <span className="text-muted-foreground">{entry.entity_type}</span>
          {entry.actor_id && (
            <span className="text-muted-foreground">
              {' '}by {entry.actor_type === 'agent' ? 'agent' : 'user'}{' '}
              {entry.actor_id.slice(0, 8)}
            </span>
          )}
        </p>
        {changesSummary && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Changed: {changesSummary}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatRelativeTime(entry.created_at)}
      </span>
    </div>
  )
}

function ChildTaskRow({
  task,
  agentMap,
}: {
  task: Issue
  agentMap: Map<string, Agent>
}) {
  const assignee = task.assignee_agent_id
    ? agentMap.get(task.assignee_agent_id)
    : null

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">
        <Link
          to={`/tasks/${task.id}`}
          className="hover:text-primary hover:underline"
        >
          {task.identifier}
        </Link>
      </TableCell>
      <TableCell className="max-w-[250px] truncate">
        <Link
          to={`/tasks/${task.id}`}
          className="text-sm hover:text-primary hover:underline"
        >
          {task.title}
        </Link>
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
        {assignee ? assignee.name : 'Unassigned'}
      </TableCell>
    </TableRow>
  )
}

function LabelsDisplay({ labels }: { labels: Label[] }) {
  if (labels.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">No labels</span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border"
          style={{
            borderColor: label.color,
            color: label.color,
          }}
        >
          <Tag className="h-3 w-3" />
          {label.name}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const companyId = useCompanyId()
  const queryClient = useQueryClient()

  const {
    data: task,
    isLoading: taskLoading,
    error: taskError,
  } = useQuery<Issue>({
    queryKey: ['task', companyId, taskId],
    queryFn: () => fetchIssue(companyId!, taskId!),
    enabled: !!companyId && !!taskId,
  })

  const { data: comments, isLoading: commentsLoading } = useQuery<Comment[]>({
    queryKey: ['comments', companyId, taskId],
    queryFn: () => fetchComments(companyId!, taskId!),
    enabled: !!companyId && !!taskId,
  })

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: !!companyId,
  })

  const { data: labels } = useQuery<Label[]>({
    queryKey: ['issue-labels', companyId, taskId],
    queryFn: () => fetchIssueLabels(companyId!, taskId!),
    enabled: !!companyId && !!taskId,
  })

  const { data: activity } = useQuery<ActivityLogEntry[]>({
    queryKey: ['activity', companyId, 'issue', taskId],
    queryFn: () => fetchActivity(companyId!, { entity_type: 'issue' }),
    enabled: !!companyId && !!taskId,
    select: (data) =>
      data.filter((entry) => entry.entity_id === taskId),
  })

  const { data: allTasks } = useQuery<Issue[]>({
    queryKey: ['tasks', companyId, 'children-of', taskId],
    queryFn: () => fetchTasks(companyId!),
    enabled: !!companyId && !!taskId,
    select: (data) => data.filter((t) => t.parent_id === taskId),
  })
  const childTasks = allTasks ?? []

  const { data: parentTask } = useQuery<Issue>({
    queryKey: ['task', companyId, task?.parent_id],
    queryFn: () => fetchIssue(companyId!, task!.parent_id!),
    enabled: !!companyId && !!task?.parent_id,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Issue>) =>
      updateIssue(companyId!, taskId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', companyId, taskId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', companyId] })
    },
  })

  if (taskLoading) return <DetailSkeleton />

  if (taskError) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Failed to load task: {(taskError as Error).message}
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <ListTodo className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Task not found</p>
      </div>
    )
  }

  const agentMap = new Map<string, Agent>()
  if (agents) {
    for (const agent of agents) {
      agentMap.set(agent.id, agent)
    }
  }

  const commentTree = comments ? buildCommentTree(comments) : []
  const totalComments = comments?.length ?? 0

  const sortedActivity = activity
    ? [...activity].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/tasks" aria-label="Back to tasks">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">
              {task.identifier}
            </span>
            <Badge
              variant={statusVariant[task.status] ?? 'secondary'}
              className="capitalize"
            >
              {statusLabel(task.status)}
            </Badge>
            <Badge
              variant={priorityVariant[task.priority] ?? 'secondary'}
              className="capitalize"
            >
              {task.priority}
            </Badge>
          </div>
          <EditableTitle
            value={task.title}
            onSave={(title) => updateMutation.mutate({ title })}
            isPending={updateMutation.isPending}
          />
        </div>
      </div>

      {parentTask && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranch className="h-4 w-4" />
          <span>Parent:</span>
          <Link
            to={`/tasks/${parentTask.id}`}
            className="text-primary hover:underline truncate"
          >
            {parentTask.identifier} {'\u2014'} {parentTask.title}
          </Link>
        </div>
      )}

      {updateMutation.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Failed to update: {(updateMutation.error as Error).message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableDescription
                value={task.description}
                onSave={(description) => updateMutation.mutate({ description })}
                isPending={updateMutation.isPending}
              />
            </CardContent>
          </Card>

          {childTasks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Sub-tasks
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({childTasks.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Priority</TableHead>
                      <TableHead className="hidden md:table-cell">Assignee</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {childTasks.map((child) => (
                      <ChildTaskRow key={child.id} task={child} agentMap={agentMap} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comments
                {totalComments > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    ({totalComments})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {companyId && taskId && (
                <AddCommentForm companyId={companyId} issueId={taskId} />
              )}
              {commentsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : commentTree.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <MessageSquare className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No comments yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {commentTree.map((comment) => (
                    <ThreadedCommentItem
                      key={comment.id}
                      comment={comment}
                      companyId={companyId!}
                      issueId={taskId!}
                      agentMap={agentMap}
                      depth={0}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Activity
                {sortedActivity.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({sortedActivity.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sortedActivity.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet</p>
              ) : (
                <div>
                  {sortedActivity.map((entry) => (
                    <ActivityItem key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              <InfoRow label="Status">
                <Select
                  value={task.status}
                  onChange={(e) => updateMutation.mutate({ status: e.target.value })}
                  disabled={updateMutation.isPending}
                  className="h-7 w-auto text-xs"
                  aria-label="Change status"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </InfoRow>

              <InfoRow label="Priority">
                <Select
                  value={task.priority}
                  onChange={(e) => updateMutation.mutate({ priority: e.target.value })}
                  disabled={updateMutation.isPending}
                  className="h-7 w-auto text-xs"
                  aria-label="Change priority"
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </InfoRow>

              <InfoRow label="Assignee">
                <Select
                  value={task.assignee_agent_id ?? ''}
                  onChange={(e) =>
                    updateMutation.mutate({
                      assignee_agent_id: e.target.value || null,
                    } as Partial<Issue>)
                  }
                  disabled={updateMutation.isPending}
                  className="h-7 w-auto text-xs"
                  aria-label="Change assignee"
                >
                  <option value="">Unassigned</option>
                  {agents?.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </Select>
              </InfoRow>

              <InfoRow label="Identifier">
                <span className="font-mono text-xs">{task.identifier}</span>
              </InfoRow>

              <InfoRow label="Created">{formatDate(task.created_at)}</InfoRow>

              {task.started_at && (
                <InfoRow label="Started">{formatDate(task.started_at)}</InfoRow>
              )}

              {task.completed_at && (
                <InfoRow label="Completed">{formatDate(task.completed_at)}</InfoRow>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Labels
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LabelsDisplay labels={labels ?? []} />
            </CardContent>
          </Card>

          {(parentTask || childTasks.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Related Tasks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {parentTask && (
                  <div>
                    <span className="text-xs text-muted-foreground">Parent</span>
                    <Link
                      to={`/tasks/${parentTask.id}`}
                      className="block text-sm text-primary hover:underline truncate"
                    >
                      {parentTask.identifier} {'\u2014'} {parentTask.title}
                    </Link>
                  </div>
                )}
                {childTasks.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Sub-tasks ({childTasks.length})
                    </span>
                    <div className="space-y-1 mt-1">
                      {childTasks.slice(0, 5).map((child) => (
                        <Link
                          key={child.id}
                          to={`/tasks/${child.id}`}
                          className="block text-sm text-primary hover:underline truncate"
                        >
                          {child.identifier} {'\u2014'} {child.title}
                        </Link>
                      ))}
                      {childTasks.length > 5 && (
                        <p className="text-xs text-muted-foreground">
                          +{childTasks.length - 5} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
