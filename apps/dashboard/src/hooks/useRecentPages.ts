import { useCallback, useSyncExternalStore } from 'react'

export interface RecentPage {
  path: string
  label: string
  timestamp: number
}

const STORAGE_KEY = 'shackle:recent-pages'
const MAX_ITEMS = 5

let listeners: Array<() => void> = []

/**
 * Cached snapshot reference — useSyncExternalStore requires getSnapshot to
 * return the SAME object reference when data has not changed. Returning a new
 * array literal on every call causes React to detect infinite re-renders
 * ("Maximum update depth exceeded") and crash the component tree.
 */
let _cachedSnapshot: RecentPage[] = []
let _cachedRaw: string | null = undefined as unknown as null

function emitChange() {
  // Bust the cache so next getSnapshot() re-reads from localStorage
  _cachedRaw = undefined as unknown as null
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(callback: () => void): () => void {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter((l) => l !== callback)
  }
}

function getSnapshot(): RecentPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // Return the same reference if the raw string has not changed
    if (raw === _cachedRaw) return _cachedSnapshot
    _cachedRaw = raw
    _cachedSnapshot = raw ? (JSON.parse(raw) as RecentPage[]) : []
    return _cachedSnapshot
  } catch {
    _cachedSnapshot = []
    _cachedRaw = null
    return _cachedSnapshot
  }
}

function getServerSnapshot(): RecentPage[] {
  return _cachedSnapshot
}

export function useRecentPages() {
  const recentPages = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  const addRecentPage = useCallback((path: string, label: string) => {
    const current = getSnapshot()
    const filtered = current.filter((p) => p.path !== path)
    const next: RecentPage[] = [
      { path, label, timestamp: Date.now() },
      ...filtered,
    ].slice(0, MAX_ITEMS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    emitChange()
  }, [])

  return { recentPages, addRecentPage }
}
