import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCompanyId } from './useCompanyId'

const STORAGE_KEY = 'shackle:company-page-memory'

interface PageMemory {
  [companyId: string]: string // companyId -> last visited pathname
}

function readMemory(): PageMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PageMemory
  } catch {
    return {}
  }
}

function writeMemory(memory: PageMemory) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
}

/**
 * Remembers the last visited page per company in localStorage.
 * When the company changes, navigates to the last visited page for that company.
 */
export function useCompanyPageMemory() {
  const companyId = useCompanyId()
  const location = useLocation()
  const navigate = useNavigate()
  const prevCompanyId = useRef<string | null>(null)
  const isRestoring = useRef(false)

  // Save current page whenever pathname changes
  useEffect(() => {
    if (!companyId || isRestoring.current) {
      isRestoring.current = false
      return
    }

    const memory = readMemory()
    memory[companyId] = location.pathname
    writeMemory(memory)
  }, [companyId, location.pathname])

  // Restore page when company changes
  useEffect(() => {
    if (!companyId) return

    // Only restore on actual company switches, not initial load
    if (prevCompanyId.current !== null && prevCompanyId.current !== companyId) {
      const memory = readMemory()
      const savedPath = memory[companyId]

      if (savedPath && savedPath !== location.pathname) {
        isRestoring.current = true
        // Preserve the company query param when navigating
        const params = new URLSearchParams(location.search)
        params.set('company', companyId)
        navigate(`${savedPath}?${params.toString()}`, { replace: true })
      }
    }

    prevCompanyId.current = companyId
  }, [companyId, navigate, location.pathname, location.search])

  const getLastPage = useCallback(
    (forCompanyId: string): string | null => {
      const memory = readMemory()
      return memory[forCompanyId] ?? null
    },
    [],
  )

  return { getLastPage }
}
