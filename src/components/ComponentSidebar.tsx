// src/components/ComponentSidebar.tsx
import { useMemo, useState } from 'react'
import { ChevronRight, Sun, Moon } from 'lucide-react'

interface SidebarComponent {
  path: string
  name: string
}

interface Props {
  components: SidebarComponent[]
  selectedPath: string | null
  searchQuery: string
  theme: 'light' | 'dark'
  onSelectPath: (path: string) => void
  onClearSelection: () => void
  onSearchChange: (query: string) => void
  onToggleTheme: () => void
}

export function ComponentSidebar({
  components, selectedPath, searchQuery, theme,
  onSelectPath, onClearSelection, onSearchChange, onToggleTheme,
}: Props) {
  // Default-collapsed groups; user clicks the group label to expand.
  // Mirrors the Files-tab tree behavior. An active search query auto-expands
  // all groups so matches are visible without manual toggling.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (!searchQuery) return components
    const q = searchQuery.toLowerCase()
    return components.filter(c => c.name.toLowerCase().includes(q))
  }, [components, searchQuery])

  const grouped = useMemo(() => {
    const groups = new Map<string, SidebarComponent[]>()
    for (const c of filtered) {
      const parts = c.path.split('/')
      const folder = parts.length > 1 ? parts[parts.length - 2] : ''
      const arr = groups.get(folder) ?? []
      arr.push(c)
      groups.set(folder, arr)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside className="cg-sidebar">
      <div className="cg-sidebar-header">
        <input
          type="search"
          className="cg-sidebar-search"
          placeholder="Search components"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
        />
        <button
          className="cg-theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
      <button
        className={`cg-sidebar-all${selectedPath === null ? ' active' : ''}`}
        onClick={onClearSelection}
      >
        All components
      </button>
      {grouped.map(([folder, items]) => {
        const groupKey = folder || '__root__'
        // Root-level items (no enclosing folder) have no toggle button to
        // expand them, so always show them. Otherwise honor the user's
        // expand state, with active search auto-expanding everything.
        const isExpanded = !folder || expandedGroups.has(groupKey) || !!searchQuery
        return (
          <div key={groupKey} className="cg-sidebar-group">
            {folder && (
              <button
                className="cg-sidebar-group-toggle"
                onClick={() => toggleGroup(groupKey)}
                aria-expanded={isExpanded}
              >
                <ChevronRight
                  size={12}
                  className={`cg-sidebar-chevron${isExpanded ? ' cg-sidebar-chevron--expanded' : ''}`}
                />
                {folder}
              </button>
            )}
            {isExpanded && items.map(c => (
              <button
                key={c.path}
                className={`cg-sidebar-item${selectedPath === c.path ? ' active' : ''}`}
                onClick={() => onSelectPath(c.path)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )
      })}
    </aside>
  )
}
