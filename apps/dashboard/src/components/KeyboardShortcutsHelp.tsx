import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { KeyboardShortcut } from '@/hooks/useKeyboardShortcuts'

interface KeyboardShortcutsHelpProps {
  open: boolean
  onClose: () => void
  shortcuts: KeyboardShortcut[]
}

/** Render a human-readable key label. */
function formatKey(key: string): string {
  const map: Record<string, string> = {
    Shift: 'Shift',
    '?': '?',
  }
  return map[key] ?? key.toUpperCase()
}

export function KeyboardShortcutsHelp({
  open,
  onClose,
  shortcuts,
}: KeyboardShortcutsHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on Escape — capture phase so it fires before the shortcut handler
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  // Focus the close button when the modal opens
  useEffect(() => {
    if (!open) return
    const el = dialogRef.current
    if (el) {
      const focusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    }
  }, [open])

  if (!open) return null

  // Group shortcuts by category
  const categories: Array<{
    key: string
    label: string
    items: KeyboardShortcut[]
  }> = []
  const categoryLabels: Record<string, string> = {
    navigation: 'Navigation',
    actions: 'Actions',
  }

  for (const s of shortcuts) {
    let group = categories.find((c) => c.key === s.category)
    if (!group) {
      group = {
        key: s.category,
        label: categoryLabels[s.category] ?? s.category,
        items: [],
      }
      categories.push(group)
    }
    group.items.push(s)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative z-50 w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close shortcuts help"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-5">
          {categories.map((category) => (
            <div key={category.key}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category.label}
              </h3>
              <div className="space-y-1.5">
                {category.items.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="text-foreground">{shortcut.label}</span>
                    <span className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && (
                            <span className="mx-0.5 text-[10px] text-muted-foreground">
                              then
                            </span>
                          )}
                          <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                            {formatKey(key)}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Cmd+K note — not managed by this system */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
              <span className="text-foreground">Open command palette</span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                  Ctrl
                </kbd>
                <span className="mx-0.5 text-[10px] text-muted-foreground">
                  +
                </span>
                <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                  K
                </kbd>
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          Press{' '}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">
            ESC
          </kbd>{' '}
          to close
        </div>
      </div>
    </div>
  )
}
