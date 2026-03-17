import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number // -1 if unknown
  hasMore: boolean
  onPageChange: (page: number) => void
}

export function Pagination({
  page,
  pageSize,
  total,
  hasMore,
  onPageChange,
}: PaginationProps) {
  const start = page * pageSize + 1
  const end = total >= 0 ? Math.min((page + 1) * pageSize, total) : (page + 1) * pageSize

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {total >= 0 ? (
          <>
            Showing {start}&ndash;{end} of {total}
          </>
        ) : (
          <>Showing {start}&ndash;{end}</>
        )}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasMore}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
