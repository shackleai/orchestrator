import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export interface KeyboardShortcut {
  /** Unique identifier */
  id: string
  /** Human-readable description */
  label: string
  /** Key sequence — single key or two-key chord (e.g. ['g', 'a']) */
  keys: string[]
  /** Category for grouping in the help modal */
  category: 'navigation' | 'actions'
  /** Action to execute */
  action: () => void
}

interface UseKeyboardShortcutsOptions {
  /** Extra shortcuts beyond the defaults */
  shortcuts?: KeyboardShortcut[]
  /** Callbacks for built-in actions */
  onToggleHelp?: () => void
}

/**
 * Determines whether the event target is an interactive element where
 * we should NOT intercept single-key shortcuts.
 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((e.target as HTMLElement)?.isContentEditable) return true
  return false
}

/**
 * Global keyboard shortcuts with support for two-key chords (e.g. g then a).
 *
 * Design choices:
 * - Does NOT intercept Cmd/Ctrl combos — those belong to the browser or
 *   CommandPalette (Ctrl+K).
 * - Ignores keystrokes inside editable fields.
 * - Two-key chords must be completed within 1.5 s.
 */
export function useKeyboardShortcuts({
  shortcuts: extraShortcuts = [],
  onToggleHelp,
}: UseKeyboardShortcutsOptions = {}) {
  const navigate = useNavigate()
  const pendingKeyRef = useRef<string | null>(null)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build the default shortcut table.
  const defaults: KeyboardShortcut[] = [
    {
      id: 'go-overview',
      label: 'Go to Overview',
      keys: ['g', 'o'],
      category: 'navigation',
      action: () => navigate('/'),
    },
    {
      id: 'go-agents',
      label: 'Go to Agents',
      keys: ['g', 'a'],
      category: 'navigation',
      action: () => navigate('/agents'),
    },
    {
      id: 'go-tasks',
      label: 'Go to Tasks',
      keys: ['g', 'i'],
      category: 'navigation',
      action: () => navigate('/tasks'),
    },
    {
      id: 'go-board',
      label: 'Go to Board',
      keys: ['g', 'b'],
      category: 'navigation',
      action: () => navigate('/board'),
    },
    {
      id: 'go-activity',
      label: 'Go to Activity',
      keys: ['g', 'v'],
      category: 'navigation',
      action: () => navigate('/activity'),
    },
    {
      id: 'go-costs',
      label: 'Go to Costs',
      keys: ['g', 'c'],
      category: 'navigation',
      action: () => navigate('/costs'),
    },
    {
      id: 'go-org-chart',
      label: 'Go to Org Chart',
      keys: ['g', 'r'],
      category: 'navigation',
      action: () => navigate('/org-chart'),
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      keys: ['g', 's'],
      category: 'navigation',
      action: () => navigate('/settings'),
    },
    {
      id: 'show-help',
      label: 'Show keyboard shortcuts',
      keys: ['Shift', '?'],
      category: 'actions',
      action: () => onToggleHelp?.(),
    },
  ]

  const allShortcuts = [...defaults, ...extraShortcuts]

  const clearPending = useCallback(() => {
    pendingKeyRef.current = null
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Never intercept modifier combos (Cmd+K, Ctrl+K, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // Never intercept inside editable fields
      if (isEditableTarget(e)) return

      const key = e.key

      // --- Handle Shift+? (shows as '?' with shiftKey) ---
      if (key === '?' && e.shiftKey) {
        const match = allShortcuts.find(
          (s) => s.keys.length === 2 && s.keys[0] === 'Shift' && s.keys[1] === '?',
        )
        if (match) {
          e.preventDefault()
          clearPending()
          match.action()
          return
        }
      }

      // --- Two-key chord handling ---
      if (pendingKeyRef.current) {
        const firstKey = pendingKeyRef.current
        clearPending()

        const match = allShortcuts.find(
          (s) =>
            s.keys.length === 2 &&
            s.keys[0] !== 'Shift' &&
            s.keys[0] === firstKey &&
            s.keys[1] === key,
        )
        if (match) {
          e.preventDefault()
          match.action()
        }
        return
      }

      // --- Start a chord if any shortcut begins with this key ---
      const startsChord = allShortcuts.some(
        (s) => s.keys.length === 2 && s.keys[0] !== 'Shift' && s.keys[0] === key,
      )
      if (startsChord) {
        pendingKeyRef.current = key
        pendingTimerRef.current = setTimeout(clearPending, 1500)
        return
      }

      // --- Single-key shortcuts ---
      const match = allShortcuts.find(
        (s) => s.keys.length === 1 && s.keys[0] === key,
      )
      if (match) {
        e.preventDefault()
        match.action()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearPending()
    }
  })

  return { shortcuts: allShortcuts }
}
