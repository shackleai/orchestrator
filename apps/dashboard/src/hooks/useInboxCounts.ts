import { useQuery } from '@tanstack/react-query'
import { fetchInboxCounts, type InboxCounts } from '@/lib/api'
import { useCompanyId } from './useCompanyId'
import { usePollingInterval, POLLING_INTERVALS } from './usePolling'

/**
 * Polls GET /api/companies/:id/inbox/count every 10 seconds.
 * Returns per-category badge counts for the sidebar.
 *
 * Requires a `userOrAgentId` to scope the unread/comment counts.
 * Falls back to 'default' when no explicit user id is available
 * (the API requires the parameter).
 */
export function useInboxCounts(userOrAgentId = 'default') {
  const companyId = useCompanyId()
  const refetchInterval = usePollingInterval(POLLING_INTERVALS.inbox)

  const { data, isLoading, error } = useQuery({
    queryKey: ['inbox-counts', companyId, userOrAgentId],
    queryFn: () => fetchInboxCounts(companyId!, userOrAgentId),
    enabled: !!companyId,
    refetchInterval,
    staleTime: 5_000,
  })

  const empty: InboxCounts = {
    unread_issues: 0,
    pending_approvals: 0,
    new_comments: 0,
    total: 0,
  }

  return {
    counts: data ?? empty,
    isLoading,
    error,
  }
}
