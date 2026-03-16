import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Settings, Sparkles, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  fetchCompany,
  fetchLicense,
  type Company,
  type LicenseKey,
} from '@/lib/api'
import { formatDate } from '@/lib/utils'

function useCompanyId() {
  const [params] = useSearchParams()
  return params.get('company') ?? 'default'
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div
                  key={j}
                  className="h-5 w-48 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-40 shrink-0 text-sm text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function UpgradeCTA() {
  return (
    <div className="rounded-lg border border-amber/30 bg-amber/5 p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-amber">
              Upgrade to ShackleAI Platform
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Unlock cloud-hosted orchestration with enterprise features.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <FeatureItem text="Cloud-hosted with 99.9% SLA" />
            <FeatureItem text="Advanced governance policies" />
            <FeatureItem text="Team collaboration and SSO" />
            <FeatureItem text="Priority support and SLAs" />
            <FeatureItem text="Unlimited agents and tasks" />
            <FeatureItem text="Custom integrations" />
          </div>
          <a
            href="https://shackleai.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-amber px-4 py-2 text-sm font-medium text-amber-foreground transition-colors hover:bg-amber/90"
          >
            View pricing
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
      {text}
    </div>
  )
}

export function SettingsPage() {
  const companyId = useCompanyId()

  const {
    data: company,
    isLoading: companyLoading,
    error: companyError,
  } = useQuery<Company>({
    queryKey: ['company', companyId],
    queryFn: () => fetchCompany(companyId),
  })

  const { data: license, isLoading: licenseLoading } = useQuery<LicenseKey | null>({
    queryKey: ['license', companyId],
    queryFn: () => fetchLicense(companyId),
    staleTime: 5 * 60 * 1000,
  })

  const isLoading = companyLoading || licenseLoading

  if (isLoading) return <SettingsSkeleton />
  if (companyError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <Settings className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Failed to load settings: {(companyError as Error).message}
        </p>
      </div>
    )
  }

  const tier = license?.tier?.toLowerCase() ?? 'free'
  const isPro = tier === 'pro'

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>

      {/* Company Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {company ? (
            <>
              <ConfigRow label="Name" value={company.name} />
              <ConfigRow
                label="Description"
                value={company.description ?? '—'}
              />
              <ConfigRow label="Status" value={company.status} />
              <ConfigRow label="Created" value={formatDate(company.created_at)} />
              <ConfigRow label="Updated" value={formatDate(company.updated_at)} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No company information available.
            </p>
          )}
        </CardContent>
      </Card>

      {/* License */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">License</CardTitle>
            <Badge
              className={
                isPro
                  ? 'border-transparent bg-amber/15 text-amber'
                  : 'border-transparent bg-secondary text-muted-foreground'
              }
            >
              {isPro ? 'Pro' : 'Free'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {license ? (
            <div className="space-y-3">
              <ConfigRow label="Tier" value={license.tier} />
              <ConfigRow
                label="Valid until"
                value={
                  license.valid_until
                    ? formatDate(license.valid_until)
                    : 'No expiration'
                }
              />
              <ConfigRow
                label="License ID"
                value={license.id.slice(0, 12) + '...'}
              />
            </div>
          ) : (
            <UpgradeCTA />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
