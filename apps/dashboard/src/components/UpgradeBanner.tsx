import { useState, useEffect } from 'react'
import { X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DISMISS_KEY = 'shackleai-upgrade-banner-dismissed'

export function UpgradeBanner() {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY)
    setDismissed(stored === 'true')
  }, [])

  if (dismissed) return null

  function handleDismiss() {
    setDismissed(true)
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  return (
    <div className="relative mb-4 rounded-lg border border-amber/30 bg-amber/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium text-amber">
            Upgrade to ShackleAI Platform
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            <li>Cloud-hosted agent orchestration with 99.9% uptime</li>
            <li>Advanced governance policies and audit logs</li>
            <li>Team collaboration, SSO, and role-based access</li>
          </ul>
          <a
            href="https://shackleai.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-medium text-amber underline underline-offset-2 hover:text-amber/80"
          >
            View pricing
          </a>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss upgrade banner"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
