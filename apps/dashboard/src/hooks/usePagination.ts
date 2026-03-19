import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface UsePaginationOptions {
  defaultPerPage?: number
  prefix?: string
}

export interface UsePaginationReturn {
  page: number
  perPage: number
  offset: number
  setPage: (page: number) => void
  setPerPage: (perPage: number) => void
  resetPage: () => void
}

const PER_PAGE_OPTIONS = [10, 25, 50] as const

export function usePagination(options: UsePaginationOptions = {}): UsePaginationReturn {
  const { defaultPerPage = 25, prefix = '' } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const pageParam = prefix ? `${prefix}_page` : 'page'
  const perPageParam = prefix ? `${prefix}_per_page` : 'per_page'

  const page = useMemo(() => {
    const raw = searchParams.get(pageParam)
    if (!raw) return 0
    const parsed = parseInt(raw, 10)
    return isNaN(parsed) || parsed < 1 ? 0 : parsed - 1
  }, [searchParams, pageParam])

  const perPage = useMemo(() => {
    const raw = searchParams.get(perPageParam)
    if (!raw) return defaultPerPage
    const parsed = parseInt(raw, 10)
    if (PER_PAGE_OPTIONS.includes(parsed as 10 | 25 | 50)) return parsed
    return defaultPerPage
  }, [searchParams, perPageParam, defaultPerPage])

  const offset = page * perPage

  const setPage = useCallback(
    (newPage: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (newPage <= 0) {
          next.delete(pageParam)
        } else {
          next.set(pageParam, String(newPage + 1))
        }
        return next
      })
    },
    [setSearchParams, pageParam],
  )

  const setPerPage = useCallback(
    (newPerPage: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (newPerPage === defaultPerPage) {
          next.delete(perPageParam)
        } else {
          next.set(perPageParam, String(newPerPage))
        }
        next.delete(pageParam)
        return next
      })
    },
    [setSearchParams, perPageParam, pageParam, defaultPerPage],
  )

  const resetPage = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(pageParam)
      return next
    })
  }, [setSearchParams, pageParam])

  return { page, perPage, offset, setPage, setPerPage, resetPage }
}

export { PER_PAGE_OPTIONS }
