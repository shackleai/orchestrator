import type { AutosaveStatus } from '@/hooks/useAutosave'
import { Check, Loader2, AlertCircle } from 'lucide-react'

interface AutosaveIndicatorProps {
  status: AutosaveStatus
  className?: string
}

const config: Record<
  AutosaveStatus,
  { icon: React.ReactNode; label: string; className: string } | null
> = {
  idle: null,
  saving: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: 'Saving...',
    className: 'text-muted-foreground',
  },
  saved: {
    icon: <Check className="h-3 w-3" />,
    label: 'Saved',
    className: 'text-emerald-500',
  },
  error: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: 'Error saving',
    className: 'text-destructive',
  },
}

/**
 * Subtle inline indicator for autosave status.
 * Renders nothing when idle.
 */
export function AutosaveIndicator({ status, className }: AutosaveIndicatorProps) {
  const entry = config[status]
  if (!entry) return null

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs transition-opacity duration-300 ${entry.className} ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      {entry.icon}
      {entry.label}
    </span>
  )
}
