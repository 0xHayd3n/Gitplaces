import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { DiscoverSidebarProps } from './DiscoverSidebar'
import type { ViewModeKey } from '../lib/discoverQueries'
import './DiscoverTopNav.css'

type TopNavTab = 'home' | 'recommended' | 'agents'
const TABS: { key: TopNavTab; label: string }[] = [
  { key: 'home',        label: 'Home' },
  { key: 'recommended', label: 'Recommended' },
  { key: 'agents',      label: 'Agents' },
]

export interface DiscoverTopNavProps extends DiscoverSidebarProps {
  viewMode: ViewModeKey
  onViewModeChange: (key: ViewModeKey) => void
  compact?: boolean
}

export default function DiscoverTopNav({
  viewMode, onViewModeChange,
  query = '', onQueryChange, onSearch, inputRef,
  compact = false,
}: DiscoverTopNavProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const localInputRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localInputRef

  useEffect(() => {
    if (searchOpen) ref.current?.focus()
  }, [searchOpen, ref])

  const closeSearch = () => {
    setSearchOpen(false)
    onQueryChange?.('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') closeSearch()
    if (e.key === 'Enter') onSearch?.()
  }

  // Map ViewModeKey to tab key. Unknown values fall back to 'home'.
  const activeTab: TopNavTab =
      viewMode === 'recommended' ? 'recommended'
    : viewMode === 'agents'      ? 'agents'
    : 'home'

  return (
    <div className={`discover-top-nav${compact ? ' discover-top-nav--compact' : ''}`}>
      <div className="dtn-pill-bar">
        {!searchOpen && (
          <button
            type="button"
            className="dtn-search-icon-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            title="Search"
          >
            <Search size={16} />
          </button>
        )}
        {!searchOpen ? (
          TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`dtn-tab${activeTab === t.key ? ' dtn-tab-active' : ''}`}
              onClick={() => onViewModeChange(t.key as ViewModeKey)}
            >
              {t.label}
            </button>
          ))
        ) : (
          <div className="dtn-search-expanded">
            <Search size={14} className="dtn-search-expanded-icon" aria-hidden="true" />
            <input
              ref={ref}
              className="dtn-search-input"
              placeholder="Search repos…"
              value={query}
              onChange={e => onQueryChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="dtn-search-close-btn"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
