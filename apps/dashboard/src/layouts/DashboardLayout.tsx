import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  LayoutGrid,
  Activity,
  DollarSign,
  Network,
  Settings,
  Menu,
  X,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UpgradeBanner } from '@/components/UpgradeBanner'
import { LicenseStatus } from '@/components/LicenseStatus'
import { CompanySelector } from '@/components/CompanySelector'
import { ThemeToggle } from '@/components/theme-toggle'
import { LiveIndicator } from '@/components/LiveIndicator'
import { CommandPalette } from '@/components/CommandPalette'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { useRecentPages } from '@/hooks/useRecentPages'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useInboxCounts } from '@/hooks/useInboxCounts'
import { useCompanyPageMemory } from '@/hooks/useCompanyPageMemory'

/** Badge key used to map nav items to inbox count fields. */
type BadgeKey = 'unread_issues' | 'pending_approvals' | 'new_comments'

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  end?: boolean
  badgeKey?: BadgeKey
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/org-chart', icon: Network, label: 'Org Chart' },
  { to: '/tasks', icon: ListTodo, label: 'Tasks', badgeKey: 'unread_issues' },
  { to: '/board', icon: LayoutGrid, label: 'Board' },
  { to: '/activity', icon: Activity, label: 'Activity', badgeKey: 'new_comments' },
  { to: '/costs', icon: DollarSign, label: 'Costs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

/** Map pathname to a human-readable label for recent pages tracking. */
function getPageLabel(pathname: string): string {
  const match = navItems.find((item) => item.to === pathname)
  if (match) return match.label
  if (pathname.startsWith('/agents/')) return 'Agent Detail'
  if (pathname.startsWith('/tasks/')) return 'Task Detail'
  return 'Page'
}

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const location = useLocation()
  const { addRecentPage } = useRecentPages()
  const { counts } = useInboxCounts()

  // Remember last visited page per company, restore on switch
  useCompanyPageMemory()

  // Global keyboard shortcuts (g+a, g+i, Shift+?, etc.)
  const { shortcuts } = useKeyboardShortcuts({
    onToggleHelp: () => setShortcutsHelpOpen((prev) => !prev),
  })

  // Track page visits for recent pages
  useEffect(() => {
    addRecentPage(location.pathname, getPageLabel(location.pathname))
  }, [location.pathname, addRecentPage])

  // Global Cmd+K / Ctrl+K shortcut
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setPaletteOpen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
        shortcuts={shortcuts}
      />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-background transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber text-amber-foreground text-xs font-bold">
              S
            </div>
            <span className="text-sm font-semibold tracking-tight">
              ShackleAI
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Company selector */}
        <div className="border-b border-border px-3 py-2">
          <CompanySelector />
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3" aria-label="Main navigation">
          {navItems.map(({ to, icon: Icon, label, end, badgeKey }) => {
            const badgeCount = badgeKey ? counts[badgeKey] : 0
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {badgeCount > 0 && (
                  <span
                    className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-amber-400"
                    aria-label={`${badgeCount} ${label.toLowerCase()} notification${badgeCount !== 1 ? 's' : ''}`}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <LicenseStatus />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b border-border bg-background px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-sm font-medium text-muted-foreground">
            Dashboard
          </h1>

          {/* Search trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto mr-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="hidden rounded border border-border bg-background px-1 py-0.5 text-[10px] font-medium sm:inline-block">
              Ctrl+K
            </kbd>
          </button>

          <div>
            <LiveIndicator />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <UpgradeBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}
