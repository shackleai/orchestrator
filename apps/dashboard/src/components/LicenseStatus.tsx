import { useQuery } from '@tanstack/react-query'
import { useCompanyId } from '@/hooks/useCompanyId'
import { Badge } from '@/components/ui/badge'
import { fetchLicense, type LicenseKey } from '@/lib/api'

export function LicenseStatus() {
  const companyId = useCompanyId()
  const { data: license } = useQuery<LicenseKey | null>({
    queryKey: ['license', companyId],
    queryFn: () => fetchLicense(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })

  const tier = license?.tier ?? 'free'
  const isPro = tier.toLowerCase() === 'pro'

  return (
    <div className="flex items-center gap-2">
      <Badge
        className={
          isPro
            ? 'border-transparent bg-amber/15 text-amber'
            : 'border-transparent bg-secondary text-muted-foreground'
        }
      >
        {isPro ? 'Pro' : 'Free'}
      </Badge>
      <span className="text-xs text-muted-foreground">
        Orchestrator v0.1.0
      </span>
    </div>
  )
}
