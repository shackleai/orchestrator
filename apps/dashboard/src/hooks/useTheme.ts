import { useState, useEffect, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'shackleai-theme'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  const root = document.documentElement

  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
  }, [])

  // Apply theme on mount and listen for system preference changes
  useEffect(() => {
    applyTheme(theme)

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const cycleTheme = useCallback(() => {
    setTheme(
      theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark',
    )
  }, [theme, setTheme])

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? getSystemTheme() : theme

  return { theme, resolvedTheme, setTheme, cycleTheme } as const
}
