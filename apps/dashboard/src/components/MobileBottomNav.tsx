import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Activity,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInboxCounts } from '@/hooks/useInboxCounts'

interface BottomNavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  end?: boolean
  badgeKey?: 'unread_issues' | 'pending_approvals' | 'new_comments'
}

const bottomNavItems: BottomNavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks', badgeKey: 'unread_issues' },
  { to: '/activity', icon: Activity, label: 'Activity', badgeKey: 'new_comments' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function MobileBottomNav() {
  const location = useLocation()
  const { counts } = useInboxCounts()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-center justify-around border-t border-border bg-background/95 backdrop-blur-sm pb-safe lg:hidden"
      aria-label="Mobile navigation"
    >
      {bottomNavItems.map(({ to, icon: Icon, label, end, badgeKey }) => {
        const isActive = end
          ? location.pathname === to
          : location.pathname.startsWith(to)
        const badgeCount = badgeKey ? counts[badgeKey] : 0

        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex flex-col items-center justify-center gap-0.5 px-3 py-1"
            aria-label={label}
          >
            <div className="relative">
              <Icon
                className={cn(
                  'h-5 w-5 transition-colors',
                  isActive
                    ? 'text-amber-500'
                    : 'text-muted-foreground',
                )}
              />
              {badgeCount > 0 && (
                <span
                  className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[8px] font-bold text-white"
                  aria-label={`${badgeCount} notification${badgeCount !== 1 ? 's' : ''}`}
                >
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </div>
            <span
              className={cn(
                'text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-amber-500'
                  : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}
