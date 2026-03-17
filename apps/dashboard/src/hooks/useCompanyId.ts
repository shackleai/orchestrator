import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { fetchCompanies } from '@/lib/api'

/**
 * Returns the active company ID.
 * - If `?company=<uuid>` is in the URL, uses that.
 * - Otherwise, fetches the company list and returns the first one.
 *
 * Returns `{ companyId, isLoading, error }`.
 */
export function useCompanyId() {
  const [params] = useSearchParams()
  const paramCompanyId = params.get('company')

  const { data: companies, isLoading, error } = useQuery({
    queryKey: ['companies'],
    queryFn: fetchCompanies,
    enabled: !paramCompanyId,
    staleTime: 5 * 60 * 1000,
  })

  const companyId = paramCompanyId ?? companies?.[0]?.id ?? null

  return { companyId, isLoading: !paramCompanyId && isLoading, error }
}
