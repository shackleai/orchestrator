import { useCallback, useSyncExternalStore } from 'react'

export interface RecentPage {
  path: string
  label: string
  timestamp: number
}

const STORAGE_KEY = 'shackle:recent-pages'
const MAX_ITEMS = 5

let listeners: Array<() => void> = []

function emitChange() {
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
    if (!raw) return []
    return JSON.parse(raw) as RecentPage[]
  } catch {
    return []
  }
}

function getServerSnapshot(): RecentPage[] {
  return []
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
