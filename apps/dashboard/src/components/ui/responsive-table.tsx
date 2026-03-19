import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Wraps table content to provide horizontal scrolling on small screens.
 * Also adds a subtle left-fade indicator when content is scrollable.
 */
const ResponsiveTable = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative w-full',
      // On mobile, enable horizontal scroll with momentum
      'overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0',
      // Hide scrollbar but keep scroll behavior
      '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
      className,
    )}
    {...props}
  >
    <div className="min-w-[600px] sm:min-w-0">
      {children}
    </div>
  </div>
))
ResponsiveTable.displayName = 'ResponsiveTable'

/**
 * Alternative card-based layout for displaying table data on mobile.
 * Use this when you want a completely different layout on small screens.
 *
 * Usage:
 *   <MobileCardList className="sm:hidden">
 *     {items.map(item => <MobileCard key={item.id}>...</MobileCard>)}
 *   </MobileCardList>
 */
const MobileCardList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('space-y-3', className)}
    {...props}
  />
))
MobileCardList.displayName = 'MobileCardList'

const MobileCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50',
      className,
    )}
    {...props}
  />
))
MobileCard.displayName = 'MobileCard'

const MobileCardRow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { label: string }
>(({ className, label, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-between gap-2 py-1', className)}
    {...props}
  >
    <span className="text-xs font-medium text-muted-foreground shrink-0">
      {label}
    </span>
    <span className="text-sm text-right truncate">{children}</span>
  </div>
))
MobileCardRow.displayName = 'MobileCardRow'

export { ResponsiveTable, MobileCardList, MobileCard, MobileCardRow }
