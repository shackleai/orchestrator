import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PER_PAGE_OPTIONS } from '@/hooks/usePagination'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
}

function getPageNumbers(current: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i)
  }

  const pages: number[] = []
  const addPage = (p: number) => {
    if (p >= 0 && p < totalPages && !pages.includes(p)) {
      pages.push(p)
    }
  }

  addPage(0)
  for (let i = current - 1; i <= current + 1; i++) {
    addPage(i)
  }
  addPage(totalPages - 1)

  pages.sort((a, b) => a - b)
  const result: number[] = []
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) {
      result.push(-1)
    }
    result.push(pages[i])
  }
  return result
}

export function Pagination({
  page,
  pageSize,
  total,
  hasMore,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const start = page * pageSize + 1
  const end =
    total >= 0
      ? Math.min((page + 1) * pageSize, total)
      : (page + 1) * pageSize

  const totalPages = total >= 0 ? Math.ceil(total / pageSize) : -1
  const pageNumbers = totalPages > 1 ? getPageNumbers(page, totalPages) : []

  const isFirstPage = page === 0
  const isLastPage = total >= 0 ? page >= totalPages - 1 : !hasMore

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          {total >= 0 ? (
            <>
              Showing {start}&ndash;{end} of {total} items
            </>
          ) : total === 0 || (page === 0 && !hasMore) ? (
            <>No items</>
          ) : (
            <>
              Showing {start}&ndash;{end}
            </>
          )}
        </p>
        {onPageSizeChange && (
          <Select
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 w-[70px] text-xs"
            aria-label="Items per page"
          >
            {PER_PAGE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={isFirstPage}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        {pageNumbers.map((p, i) =>
          p === -1 ? (
            <span
              key={`ellipsis-${i}`}
              className="px-1 text-xs text-muted-foreground select-none"
              aria-hidden
            >
              ...
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? 'page' : undefined}
              className="hidden sm:inline-flex min-w-[32px]"
            >
              {p + 1}
            </Button>
          ),
        )}

        {totalPages > 1 && (
          <span className="px-2 text-xs text-muted-foreground sm:hidden">
            {page + 1} / {totalPages > 0 ? totalPages : '?'}
          </span>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={isLastPage}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
