import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRelativeTime(date: string | Date | null): string {
  if (!date) return 'Never'
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt) return '\u2014'
  const start = new Date(startedAt)
  const end = finishedAt ? new Date(finishedAt) : new Date()
  const diffMs = end.getTime() - start.getTime()
  if (diffMs < 1000) return `${diffMs}ms`
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainingSecs = secs % 60
  if (mins < 60) return `${mins}m ${remainingSecs}s`
  const hours = Math.floor(mins / 60)
  const remainingMins = mins % 60
  return `${hours}h ${remainingMins}m`
}

export function humanizeEventType(eventType: string): string {
  return eventType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function redactPaths(text: string): string {
  // Replace absolute Windows paths (D:\..., C:\...)
  let result = text.replace(
    /[A-Z]:\\(?:[^\s\\]+\\)*([^\s\\]+)/g,
    (_match, filename: string) => `./${filename}`,
  )
  // Replace absolute Unix paths (/home/..., /Users/...)
  result = result.replace(
    /\/(?:home|Users|tmp|var|opt)\/(?:[^\s/]+\/)*([^\s/]+)/g,
    (_match, filename: string) => `./${filename}`,
  )
  return result
}
