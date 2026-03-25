import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCompanyId } from '@/hooks/useCompanyId'
import {
  Settings,
  Sparkles,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  LogOut,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import { clearAuth } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  fetchCompany,
  fetchLicense,
  fetchSecrets,
  storeSecret,
  deleteSecret,
  type Company,
  type LicenseKey,
  type SecretListItem,
} from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

interface ProviderDef {
  name: string
  label: string
  envVar: string
  placeholder: string
  docsUrl: string
}

const PROVIDERS: ProviderDef[] = [
  {
    name: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    name: 'google',
    label: 'Google (Gemini)',
    envVar: 'GOOGLE_API_KEY',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
]

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ProviderCard — single provider key management
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderDef
  isConfigured: boolean
  companyId: string
  onSaved: () => void
}

function ProviderCard({ provider, isConfigured, companyId, onSaved }: ProviderCardProps) {
  const { toast } = useToast()
  const [keyValue, setKeyValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = useCallback(async () => {
    if (!keyValue.trim()) return
    setSaving(true)
    try {
      // If a key already exists, delete it first (secrets API returns 409 on duplicate)
      if (isConfigured) {
        await deleteSecret(companyId, provider.envVar)
      }
      await storeSecret(companyId, provider.envVar, keyValue.trim())
      setKeyValue('')
      setShowKey(false)
      onSaved()
      toast(`${provider.label} API key saved`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save key'
      toast(`Failed to save ${provider.label} key: ${message}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [companyId, keyValue, isConfigured, provider, onSaved, toast])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await deleteSecret(companyId, provider.envVar)
      onSaved()
      toast(`${provider.label} API key removed`, 'info')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove key'
      toast(`Failed to remove ${provider.label} key: ${message}`, 'error')
    } finally {
      setDeleting(false)
    }
  }, [companyId, provider, onSaved, toast])

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{provider.label}</span>
        </div>
        {isConfigured ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Configured
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Not Set
          </Badge>
        )}
      </div>

      {/* Env var name */}
      <p className="text-xs text-muted-foreground font-mono">{provider.envVar}</p>

      {/* Input row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Input
            type={showKey ? 'text' : 'password'}
            placeholder={isConfigured ? 'Enter new key to replace...' : provider.placeholder}
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            className="pr-10"
            aria-label={`${provider.label} API key`}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !keyValue.trim()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving
              </>
            ) : (
              'Save'
            )}
          </Button>
          {isConfigured && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDelete}
              disabled={deleting}
              className="text-destructive hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Remove'
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Docs link */}
      <a
        href={provider.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Get an API key
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProvidersCard — all providers
// ---------------------------------------------------------------------------

function ProvidersCard({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient()

  const { data: secrets, isLoading } = useQuery<SecretListItem[]>({
    queryKey: ['secrets', companyId],
    queryFn: () => fetchSecrets(companyId),
    staleTime: 15 * 1000,
  })

  const configuredNames = new Set(secrets?.map((s) => s.name) ?? [])

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['secrets', companyId] })
  }, [queryClient, companyId])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">LLM Providers</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure API keys for LLM providers. Keys are encrypted and injected into agent processes at runtime.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.name}
                provider={provider}
                isConfigured={configuredNames.has(provider.envVar)}
                companyId={companyId}
                onSaved={handleSaved}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const companyId = useCompanyId()

  const {
    data: company,
    isLoading: companyLoading,
    error: companyError,
  } = useQuery<Company>({
    queryKey: ['company', companyId],
    queryFn: () => fetchCompany(companyId!),
    enabled: !!companyId,
  })

  const { data: license, isLoading: licenseLoading } = useQuery<LicenseKey | null>({
    queryKey: ['license', companyId],
    queryFn: () => fetchLicense(companyId!),
    enabled: !!companyId,
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
                value={company.description ?? '\u2014'}
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

      {/* LLM Providers */}
      {companyId && <ProvidersCard companyId={companyId} />}

      {/* Session */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { clearAuth(); window.location.reload() }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect & Clear API Key
          </Button>
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
