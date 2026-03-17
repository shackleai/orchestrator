import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { fetchCompanies } from '@/lib/api'
import { Select } from '@/components/ui/select'
import { Building2 } from 'lucide-react'

/**
 * Dropdown that lists all companies and allows switching between them.
 * Persists selection via `?company=<id>` URL search parameter.
 */
export function CompanySelector() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('company')

  const {
    data: companies,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['companies'],
    queryFn: fetchCompanies,
    staleTime: 5 * 60 * 1000,
  })

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const next = new URLSearchParams(params)
    if (value) {
      next.set('company', value)
    } else {
      next.delete('company')
    }
    setParams(next, { replace: true })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground">
        <Building2 className="h-3.5 w-3.5 animate-pulse" />
        <span>Loading...</span>
      </div>
    )
  }

  if (error || !companies) {
    return null
  }

  // Resolve which company is currently selected
  const activeId = selectedId ?? companies[0]?.id ?? ''

  return (
    <div className="px-1">
      <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Building2 className="h-3 w-3" />
        Company
      </label>
      <Select
        value={activeId}
        onChange={handleChange}
        className="h-8 text-xs"
        aria-label="Select company"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  )
}
