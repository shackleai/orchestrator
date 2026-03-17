import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { fetchCompanies } from '@/lib/api'

/**
 * Returns the active company ID as a plain string, or null while loading.
 * - If `?company=<uuid>` is in the URL, uses that.
 * - Otherwise, fetches the company list and returns the first one.
 */
export function useCompanyId(): string | null {
  const [params] = useSearchParams()
  const paramCompanyId = params.get('company')

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: fetchCompanies,
    enabled: !paramCompanyId,
    staleTime: 5 * 60 * 1000,
  })

  return paramCompanyId ?? companies?.[0]?.id ?? null
}
