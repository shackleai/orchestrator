import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  LayoutGrid,
  Activity,
  DollarSign,
  Network,
  Settings,
  Search,
  Plus,
  Clock,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchAgents, fetchTasks } from '@/lib/api'
import { useCompanyId } from '@/hooks/useCompanyId'
import { useDebounce } from '@/hooks/useDebounce'
import { useRecentPages } from '@/hooks/useRecentPages'

// --- Types ---

interface CommandItem {
  id: string
  label: string
  category: 'page' | 'agent' | 'task' | 'action' | 'recent'
  icon: React.ReactNode
  path: string
  subtitle?: string
}

// --- Static items ---

const PAGE_ITEMS: CommandItem[] = [
  { id: 'page-overview', label: 'Overview', category: 'page', icon: <LayoutDashboard className="h-4 w-4" />, path: '/' },
  { id: 'page-agents', label: 'Agents', category: 'page', icon: <Bot className="h-4 w-4" />, path: '/agents' },
  { id: 'page-tasks', label: 'Tasks', category: 'page', icon: <ListTodo className="h-4 w-4" />, path: '/tasks' },
  { id: 'page-board', label: 'Board', category: 'page', icon: <LayoutGrid className="h-4 w-4" />, path: '/board' },
  { id: 'page-activity', label: 'Activity', category: 'page', icon: <Activity className="h-4 w-4" />, path: '/activity' },
  { id: 'page-costs', label: 'Costs', category: 'page', icon: <DollarSign className="h-4 w-4" />, path: '/costs' },
  { id: 'page-org-chart', label: 'Org Chart', category: 'page', icon: <Network className="h-4 w-4" />, path: '/org-chart' },
  { id: 'page-settings', label: 'Settings', category: 'page', icon: <Settings className="h-4 w-4" />, path: '/settings' },
]

const ACTION_ITEMS: CommandItem[] = [
  { id: 'action-create-agent', label: 'Create Agent', category: 'action', icon: <Plus className="h-4 w-4" />, path: '/agents', subtitle: 'Add a new agent' },
  { id: 'action-create-task', label: 'Create Task', category: 'action', icon: <Plus className="h-4 w-4" />, path: '/tasks', subtitle: 'Create a new task' },
  { id: 'action-settings', label: 'Go to Settings', category: 'action', icon: <ArrowRight className="h-4 w-4" />, path: '/settings', subtitle: 'Account & preferences' },
]

// --- Fuzzy match ---

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) qi++
  }
  return qi === lowerQuery.length
}

function fuzzyScore(text: string, query: string): number {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerText.startsWith(lowerQuery)) return 3
  if (lowerText.includes(lowerQuery)) return 2
  if (fuzzyMatch(text, query)) return 1
  return 0
}

// --- Category labels ---

const CATEGORY_LABELS: Record<CommandItem['category'], string> = {
  recent: 'Recent',
  page: 'Pages',
  agent: 'Agents',
  task: 'Tasks',
  action: 'Quick Actions',
}

const CATEGORY_ORDER: CommandItem['category'][] = [
  'recent',
  'page',
  'agent',
  'task',
  'action',
]

// --- Component ---

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 150)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const companyId = useCompanyId()
  const { recentPages } = useRecentPages()

  // Fetch agents and tasks for search
  const { data: agents } = useQuery({
    queryKey: ['agents', companyId],
    queryFn: () => fetchAgents(companyId!),
    enabled: open && !!companyId,
    staleTime: 30_000,
  })

  const { data: tasks } = useQuery({
    queryKey: ['tasks-palette', companyId],
    queryFn: () => fetchTasks(companyId!, undefined, { limit: 50, offset: 0 }),
    enabled: open && !!companyId,
    staleTime: 30_000,
  })

  // Build dynamic items
  const agentItems: CommandItem[] = useMemo(
    () =>
      (agents ?? []).map((a) => ({
        id: `agent-${a.id}`,
        label: a.name,
        category: 'agent' as const,
        icon: <Bot className="h-4 w-4" />,
        path: `/agents/${a.id}`,
        subtitle: a.role,
      })),
    [agents],
  )

  const taskItems: CommandItem[] = useMemo(
    () =>
      (tasks ?? []).map((t) => ({
        id: `task-${t.id}`,
        label: t.title,
        category: 'task' as const,
        icon: <ListTodo className="h-4 w-4" />,
        path: `/tasks/${t.id}`,
        subtitle: `${t.identifier} - ${t.status}`,
      })),
    [tasks],
  )

  const recentItems: CommandItem[] = useMemo(
    () =>
      recentPages.map((r) => ({
        id: `recent-${r.path}`,
        label: r.label,
        category: 'recent' as const,
        icon: <Clock className="h-4 w-4" />,
        path: r.path,
      })),
    [recentPages],
  )

  // All items
  const allItems = useMemo(
    () => [...recentItems, ...PAGE_ITEMS, ...agentItems, ...taskItems, ...ACTION_ITEMS],
    [recentItems, agentItems, taskItems],
  )

  // Filter and sort
  const filteredItems = useMemo(() => {
    if (!debouncedQuery.trim()) {
      // Show recent first, then pages and actions (skip agents/tasks when no query)
      return [...recentItems, ...PAGE_ITEMS, ...ACTION_ITEMS]
    }
    return allItems
      .map((item) => ({ item, score: fuzzyScore(item.label, debouncedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
  }, [debouncedQuery, allItems, recentItems])

  // Group by category
  const groupedItems = useMemo(() => {
    const groups: Array<{ category: CommandItem['category']; label: string; items: CommandItem[] }> = []
    for (const cat of CATEGORY_ORDER) {
      const items = filteredItems.filter((i) => i.category === cat)
      if (items.length > 0) {
        groups.push({ category: cat, label: CATEGORY_LABELS[cat], items })
      }
    }
    return groups
  }, [filteredItems])

  // Flat list for keyboard navigation
  const flatItems = useMemo(
    () => groupedItems.flatMap((g) => g.items),
    [groupedItems],
  )

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Reset active index when filtered results change
  useEffect(() => {
    setActiveIndex(0)
  }, [debouncedQuery])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector('[data-active="true"]')
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSelect = useCallback(
    (item: CommandItem) => {
      onClose()
      navigate(item.path)
    },
    [navigate, onClose],
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((i) => (i + 1) % Math.max(flatItems.length, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((i) => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1))
          break
        case 'Enter':
          e.preventDefault()
          if (flatItems[activeIndex]) {
            handleSelect(flatItems[activeIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [flatItems, activeIndex, handleSelect, onClose],
  )

  if (!open) return null

  let flatIndex = 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      role="presentation"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* Palette */}
      <div
        className="relative z-50 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, agents, tasks..."
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search commands"
            aria-activedescendant={flatItems[activeIndex]?.id}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-[300px] overflow-y-auto p-2"
        >
          {flatItems.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.category} className="mb-1">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const currentIndex = flatIndex++
                  const isActive = currentIndex === activeIndex
                  return (
                    <button
                      key={item.id}
                      id={item.id}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                      )}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActiveIndex(currentIndex)}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.subtitle && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">
              &uarr;&darr;
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">
              &crarr;
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}
