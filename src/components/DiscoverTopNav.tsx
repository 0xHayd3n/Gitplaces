import { useState, useRef, useEffect } from 'react'
import { ChevronUp, Grid3X3, List, Settings } from 'lucide-react'
import { FilterPanel, AdvancedPanel, type DiscoverSidebarProps } from './DiscoverSidebar'
import type { ListDensity } from './LayoutDropdown'
import logoSrc from '../assets/logo.png'
import './DiscoverTopNav.css'

export default function DiscoverTopNav(props: DiscoverSidebarProps) {
  const {
    selectedSubtypes, onSelectedSubtypesChange,
    filters, selectedLanguages, activeVerification,
    onFilterChange, onSelectedLanguagesChange, onVerificationToggle,
    activePanel, onActivePanelChange,
    mode = 'discover', skillStatus, onSkillStatusChange, itemCounts,
    query = '', onQueryChange, onSearch, inputRef,
    layoutPrefs, onLayoutChange,
    compact = false,
  } = props

  const wrapperRef = useRef<HTMLDivElement>(null)

  const [filterOpen, setFilterOpen] = useState(
    activePanel !== null && activePanel !== 'buckets'
  )
  const [filterTab, setFilterTab] = useState<'languages' | 'types' | 'advanced' | 'view'>(
    activePanel === 'advanced' ? 'advanced' : 'languages'
  )
  const [filterSearch, setFilterSearch] = useState('')

  const languageCount = selectedLanguages.length
  const typeCount = selectedSubtypes.length
  const filterCount = languageCount + typeCount
  const advancedCount =
    (filters.stars    ? 1 : 0) +
    (filters.activity ? 1 : 0) +
    (filters.license  ? 1 : 0) +
    activeVerification.size
  const totalCount = filterCount + advancedCount

  const isCategorySearch = filterOpen && (filterTab === 'languages' || filterTab === 'types')

  const onActivePanelChangeRef = useRef(onActivePanelChange)
  useEffect(() => { onActivePanelChangeRef.current = onActivePanelChange })

  const toggleFilter = () => {
    if (filterOpen) {
      setFilterOpen(false)
      setFilterSearch('')
      onActivePanelChange(null)
    } else {
      setFilterOpen(true)
      onActivePanelChange(filterTab === 'advanced' ? 'advanced' : 'filters')

    }
  }

  const switchTab = (tab: 'languages' | 'types' | 'advanced' | 'view') => {
    setFilterTab(tab)
    onActivePanelChange(tab === 'advanced' ? 'advanced' : (tab === 'languages' || tab === 'types') ? 'filters' : null)
  }

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setFilterOpen(false)
        setFilterSearch('')
        onActivePanelChangeRef.current(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const handleModeSwitch = (m: 'grid' | 'list') => {
    if (layoutPrefs && onLayoutChange) onLayoutChange({ ...layoutPrefs, mode: m })
  }

  const setColumns = (columns: number) => {
    if (layoutPrefs && onLayoutChange) onLayoutChange({ ...layoutPrefs, columns })
  }

  const setDensity = (density: ListDensity) => {
    if (layoutPrefs && onLayoutChange) onLayoutChange({ ...layoutPrefs, density })
  }

  const toggleField = (field: 'description' | 'tags' | 'stats' | 'type' | 'verification') => {
    if (!layoutPrefs || !onLayoutChange) return
    onLayoutChange({ ...layoutPrefs, fields: { ...layoutPrefs.fields, [field]: !layoutPrefs.fields[field] } })
  }

  return (
    <div ref={wrapperRef} className={`discover-top-nav${compact ? ' discover-top-nav--compact' : ''}`}>
      {/* Branding */}
      {!compact && (
        <div className="dtn-brand">
          <img src={logoSrc} alt="" className="dtn-brand-logo" />
          <span className="dtn-brand-name">Git Suite</span>
        </div>
      )}

      {/* Unified search + filter panel */}
      <div className={`dtn-search-panel${filterOpen ? ' open' : ''}`} title="">
        <div className="dtn-search-bar">
          <svg className="dtn-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className="dtn-search-input"
            placeholder={filterTab === 'languages' && filterOpen ? 'Search languages…' : filterTab === 'types' && filterOpen ? 'Search types…' : 'Search repos…'}
            value={isCategorySearch ? filterSearch : query}
            onChange={e => isCategorySearch ? setFilterSearch(e.target.value) : onQueryChange?.(e.target.value)}
            onKeyDown={e => !isCategorySearch && e.key === 'Enter' && onSearch?.()}
          />
          {!filterOpen && compact && (
            <button
              type="button"
              className="dtn-search-filter-btn"
              onMouseDown={e => { e.stopPropagation(); toggleFilter() }}
              aria-expanded={false}
            >
              <Settings size={13} />
              {totalCount > 0 && <span className="dtn-filter-badge">{totalCount}</span>}
            </button>
          )}
        </div>

        {filterOpen && (
          <>
            <div className="dtn-panel-tabs">
              <button
                className={`dtn-panel-tab${filterTab === 'languages' ? ' active' : ''}`}
                onClick={() => switchTab('languages')}
              >
                Languages
                {languageCount > 0 && <span className="dtn-tab-badge">{languageCount}</span>}
              </button>
              <button
                className={`dtn-panel-tab${filterTab === 'types' ? ' active' : ''}`}
                onClick={() => switchTab('types')}
              >
                Types
                {typeCount > 0 && <span className="dtn-tab-badge">{typeCount}</span>}
              </button>
              <button
                className={`dtn-panel-tab${filterTab === 'advanced' ? ' active' : ''}`}
                onClick={() => switchTab('advanced')}
              >
                Advanced Filters
                {advancedCount > 0 && <span className="dtn-tab-badge">{advancedCount}</span>}
              </button>
              {layoutPrefs && onLayoutChange && (
                <button
                  className={`dtn-panel-tab${filterTab === 'view' ? ' active' : ''}`}
                  onClick={() => switchTab('view')}
                >
                  View
                </button>
              )}
            </div>

            <div className="dtn-panel-content">
              {(filterTab === 'languages' || filterTab === 'types') && (
                <FilterPanel
                  selectedLanguages={selectedLanguages}
                  onSelectedLanguagesChange={onSelectedLanguagesChange}
                  selectedSubtypes={selectedSubtypes}
                  onSelectedSubtypesChange={onSelectedSubtypesChange}
                  itemCounts={itemCounts}
                  embedded
                  activeTab={filterTab === 'languages' ? 'language' : 'type'}
                  search={filterSearch}
                />
              )}
              {filterTab === 'advanced' && (
                <AdvancedPanel
                  filters={filters}
                  activeVerification={activeVerification}
                  onFilterChange={onFilterChange}
                  onVerificationToggle={onVerificationToggle}
                  mode={mode}
                  skillStatus={skillStatus}
                  onSkillStatusChange={onSkillStatusChange}
                />
              )}
              {filterTab === 'view' && layoutPrefs && onLayoutChange && (
                <div className="dtn-view-panel">
                  <div className="dtn-layout-mode-row">
                    <button
                      className={`dtn-layout-mode-btn${layoutPrefs.mode === 'grid' ? ' active' : ''}`}
                      onClick={() => handleModeSwitch('grid')}
                    >
                      <Grid3X3 size={13} />
                      <span>Grid</span>
                    </button>
                    <button
                      className={`dtn-layout-mode-btn${layoutPrefs.mode === 'list' ? ' active' : ''}`}
                      onClick={() => handleModeSwitch('list')}
                    >
                      <List size={13} />
                      <span>List</span>
                    </button>
                  </div>
                  {layoutPrefs.mode === 'grid' ? (
                    <>
                      <div className="layout-popover-label">Columns</div>
                      <div className="layout-popover-row">
                        {[4, 5, 6, 7, 8].map(n => (
                          <button
                            key={n}
                            className={`layout-column-btn${layoutPrefs.columns === n ? ' active' : ''}`}
                            onClick={() => setColumns(n)}
                          >{n}</button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="layout-popover-label">Density</div>
                      <div className="layout-popover-row">
                        <button
                          className={`layout-segment-btn${layoutPrefs.density === 'compact' ? ' active' : ''}`}
                          onClick={() => setDensity('compact')}
                        >Compact</button>
                        <button
                          className={`layout-segment-btn${layoutPrefs.density === 'comfortable' ? ' active' : ''}`}
                          onClick={() => setDensity('comfortable')}
                        >Comfortable</button>
                      </div>
                      <div className="layout-popover-label">Show</div>
                      {(['description', 'tags', 'stats', 'type', 'verification'] as const).map(field => (
                        <label key={field} className="layout-field-row">
                          <input
                            type="checkbox"
                            checked={layoutPrefs.fields[field]}
                            onChange={() => toggleField(field)}
                          />
                          {field.charAt(0).toUpperCase() + field.slice(1)}
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="dtn-panel-collapse-btn"
              onMouseDown={e => { e.stopPropagation(); toggleFilter() }}
              aria-label="Collapse filter panel"
            >
              <ChevronUp size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
