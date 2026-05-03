// src/components/ComponentSidebar.tsx
import { useMemo } from 'react'

interface SidebarComponent {
  path: string
  name: string
}

interface Props {
  components: SidebarComponent[]
  selectedPath: string | null
  searchQuery: string
  onSelectPath: (path: string) => void
  onClearSelection: () => void
  onSearchChange: (query: string) => void
}

export function ComponentSidebar({
  components, selectedPath, searchQuery,
  onSelectPath, onClearSelection, onSearchChange,
}: Props) {
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

  return (
    <aside className="cg-sidebar">
      <input
        type="search"
        className="cg-sidebar-search"
        placeholder="Search components"
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
      />
      <button
        className={`cg-sidebar-all${selectedPath === null ? ' active' : ''}`}
        onClick={onClearSelection}
      >
        All components
      </button>
      {grouped.map(([folder, items]) => (
        <div key={folder || '__root__'} className="cg-sidebar-group">
          {folder && <div className="cg-sidebar-group-label">{folder}</div>}
          {items.map(c => (
            <button
              key={c.path}
              className={`cg-sidebar-item${selectedPath === c.path ? ' active' : ''}`}
              onClick={() => onSelectPath(c.path)}
            >
              {c.name}
            </button>
          ))}
        </div>
      ))}
    </aside>
  )
}
