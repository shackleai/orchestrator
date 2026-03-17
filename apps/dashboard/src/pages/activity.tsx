import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCompanyId } from '@/hooks/useCompanyId'
import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { fetchActivity, type ActivityLogEntry } from '@/lib/api'
import { Pagination } from '@/components/ui/pagination'
import { formatRelativeTime } from '@/lib/utils'

const ACTIVITY_PAGE_SIZE = 30

const entityTypeOptions = [
  { value: '', label: 'All entities' },
  { value: 'agent', label: 'Agent' },
  { value: 'issue', label: 'Issue' },
  { value: 'company', label: 'Company' },
  { value: 'policy', label: 'Policy' },
]

const actionColor: Record<string, string> = {
  create: 'bg-emerald-500/15 text-emerald-400',
  update: 'bg-blue-500/15 text-blue-400',
  delete: 'bg-red-500/15 text-red-400',
  assign: 'bg-violet-500/15 text-violet-400',
  execute: 'bg-amber-500/15 text-amber-400',
}

function ActionBadge({ action }: { action: string }) {
  const colorClass = actionColor[action] ?? 'bg-secondary text-secondary-foreground'
  return (
    <Badge className={`border-transparent capitalize ${colorClass}`}>
      {action}
    </Badge>
  )
}

function ActivitySkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ActivityEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Activity className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">No activity found</p>
      <p className="text-xs text-muted-foreground">
        Activity events will appear here as agents operate.
      </p>
    </div>
  )
}

export function ActivityPage() {
  const companyId = useCompanyId()
  const [entityType, setEntityType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)

  // Reset to page 0 when filters change
  const handleEntityTypeChange = (value: string) => {
    setEntityType(value)
    setPage(0)
  }
  const handleFromDateChange = (value: string) => {
    setFromDate(value)
    setPage(0)
  }
  const handleToDateChange = (value: string) => {
    setToDate(value)
    setPage(0)
  }

  const { data: rawEntries, isLoading, error } = useQuery<ActivityLogEntry[]>({
    queryKey: ['activity', companyId, entityType, fromDate, toDate, page],
    queryFn: () =>
      fetchActivity(
        companyId!,
        {
          entity_type: entityType || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        },
        {
          limit: ACTIVITY_PAGE_SIZE + 1,
          offset: page * ACTIVITY_PAGE_SIZE,
        },
      ),
    enabled: !!companyId,
    refetchInterval: 10_000,
  })

  const hasMore = (rawEntries?.length ?? 0) > ACTIVITY_PAGE_SIZE
  const entries = rawEntries ? rawEntries.slice(0, ACTIVITY_PAGE_SIZE) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Activity Log</h2>
        <div className="flex flex-wrap gap-2">
          <Select
            value={entityType}
            onChange={(e) => handleEntityTypeChange(e.target.value)}
            className="w-36"
            aria-label="Filter by entity type"
          >
            {entityTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => handleFromDateChange(e.target.value)}
            className="w-36"
            aria-label="From date"
            placeholder="From"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => handleToDateChange(e.target.value)}
            className="w-36"
            aria-label="To date"
            placeholder="To"
          />
        </div>
      </div>

      {isLoading ? (
        <ActivitySkeleton />
      ) : error ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          Failed to load activity: {(error as Error).message}
        </div>
      ) : !entries || entries.length === 0 ? (
        page === 0 ? (
          <ActivityEmpty />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No more activity to display.
          </div>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {entries.length} event{entries.length !== 1 ? 's' : ''} on this page
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            <ul
              className="space-y-2"
              role="list"
            >
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionBadge action={entry.action} />
                    <Badge variant="secondary" className="capitalize">
                      {entry.entity_type}
                    </Badge>
                    {entry.entity_id && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.entity_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {entry.actor_type}
                      {entry.actor_id && (
                        <span className="font-mono">
                          /{entry.actor_id.slice(0, 8)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0">
                      {formatRelativeTime(entry.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={ACTIVITY_PAGE_SIZE}
              total={-1}
              hasMore={hasMore}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
