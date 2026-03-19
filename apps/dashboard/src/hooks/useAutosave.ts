import { useState, useEffect, useRef, useCallback } from 'react'
import { useDebounce } from './useDebounce'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutosaveOptions<T> {
  /** The current value to autosave */
  value: T
  /** The last persisted/server value — autosave is skipped when value matches this */
  savedValue: T
  /** Async function that performs the save */
  onSave: (value: T) => Promise<unknown>
  /** Debounce delay in ms (default: 2000) */
  delay?: number
  /** Whether autosave is enabled (default: true) */
  enabled?: boolean
}

interface UseAutosaveReturn {
  status: AutosaveStatus
  /** Manually trigger a save immediately */
  saveNow: () => void
}

/**
 * Debounced autosave hook.
 *
 * Waits `delay` ms after the last change, then calls `onSave`.
 * Skips the save if the value hasn't actually changed from the last
 * persisted value.
 *
 * Returns a status indicator and a manual `saveNow` escape hatch.
 */
export function useAutosave<T>({
  value,
  savedValue,
  onSave,
  delay = 2000,
  enabled = true,
}: UseAutosaveOptions<T>): UseAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const debouncedValue = useDebounce(value, delay)
  const onSaveRef = useRef(onSave)
  const savedValueRef = useRef(savedValue)
  const isSavingRef = useRef(false)

  // Keep refs in sync without triggering effects
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    savedValueRef.current = savedValue
  }, [savedValue])

  const performSave = useCallback(async (val: T) => {
    if (isSavingRef.current) return
    if (serialize(val) === serialize(savedValueRef.current)) return

    isSavingRef.current = true
    setStatus('saving')

    try {
      await onSaveRef.current(val)
      setStatus('saved')
      // Reset to idle after 2s so the "Saved" indicator fades
      setTimeout(() => {
        setStatus((prev) => (prev === 'saved' ? 'idle' : prev))
      }, 2000)
    } catch {
      setStatus('error')
    } finally {
      isSavingRef.current = false
    }
  }, [])

  // Auto-save on debounced value change
  useEffect(() => {
    if (!enabled) return
    performSave(debouncedValue)
  }, [debouncedValue, enabled, performSave])

  const saveNow = useCallback(() => {
    performSave(value)
  }, [value, performSave])

  return { status, saveNow }
}

/** Simple serialization for shallow equality checks */
function serialize<T>(val: T): string {
  if (typeof val === 'string') return val
  return JSON.stringify(val)
}
