import { Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePollingControls } from '@/hooks/usePolling'

/**
 * Subtle "Live" indicator shown in the dashboard header.
 * Shows a pulsing green dot when polling is active.
 * Clicking toggles the manual pause state.
 */
export function LiveIndicator() {
  const { isActive, isPaused, isVisible, togglePause } = usePollingControls()

  const label = isPaused
    ? 'Paused'
    : !isVisible
      ? 'Paused (tab hidden)'
      : 'Live'

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={togglePause}
      className="gap-1.5 text-xs font-medium h-8 px-2"
      aria-label={isActive ? 'Pause live updates' : 'Resume live updates'}
      title={isActive ? 'Click to pause live updates' : 'Click to resume live updates'}
    >
      {isActive ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-emerald-600 dark:text-emerald-400">Live</span>
        </>
      ) : (
        <>
          <Pause className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">{label}</span>
        </>
      )}
    </Button>
  )
}
