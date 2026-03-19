import { useCallback, useSyncExternalStore } from 'react'

/**
 * Default polling intervals (in milliseconds) for each dashboard section.
 */
export const POLLING_INTERVALS = {
  agents: 5_000,
  tasks: 3_000,
  kanban: 3_000,
  activity: 5_000,
  costs: 10_000,
  overview: 5_000,
  inbox: 10_000,
} as const

// --- Page visibility external store ---

function subscribeToVisibility(callback: () => void): () => void {
  document.addEventListener('visibilitychange', callback)
  return () => document.removeEventListener('visibilitychange', callback)
}

function getVisibilitySnapshot(): boolean {
  return !document.hidden
}

function getServerSnapshot(): boolean {
  return true
}

/**
 * Returns true when the browser tab is visible.
 * Uses useSyncExternalStore for tear-free reads.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeToVisibility,
    getVisibilitySnapshot,
    getServerSnapshot,
  )
}

// --- Global polling pause state ---

let globalPaused = false
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribeToGlobalPause(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getGlobalPausedSnapshot(): boolean {
  return globalPaused
}

export function setGlobalPollingPaused(paused: boolean): void {
  if (globalPaused !== paused) {
    globalPaused = paused
    notifyListeners()
  }
}

export function useGlobalPollingPaused(): boolean {
  return useSyncExternalStore(
    subscribeToGlobalPause,
    getGlobalPausedSnapshot,
    () => false,
  )
}

/**
 * Returns a refetchInterval value compatible with @tanstack/react-query.
 * Returns `false` when polling should be paused (tab hidden or manually paused).
 *
 * Usage:
 *   const refetchInterval = usePollingInterval(POLLING_INTERVALS.agents)
 *
 *   useQuery({
 *     queryKey: [...],
 *     queryFn: ...,
 *     refetchInterval,
 *   })
 */
export function usePollingInterval(intervalMs: number): number | false {
  const isVisible = usePageVisible()
  const isPaused = useGlobalPollingPaused()

  if (!isVisible || isPaused) return false
  return intervalMs
}

/**
 * Hook that provides polling controls for the UI.
 * Returns the active state and a toggle function.
 */
export function usePollingControls() {
  const isVisible = usePageVisible()
  const isPaused = useGlobalPollingPaused()

  const isActive = isVisible && !isPaused

  const togglePause = useCallback(() => {
    setGlobalPollingPaused(!globalPaused)
  }, [])

  return {
    /** Whether polling is currently active (visible + not paused) */
    isActive,
    /** Whether the user has manually paused polling */
    isPaused,
    /** Whether the browser tab is visible */
    isVisible,
    /** Toggle the manual pause state */
    togglePause,
  }
}
