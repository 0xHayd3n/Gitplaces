import { useEffect, useRef, useState } from 'react'
import { FilterPanel, AdvancedPanel, type DiscoverSidebarProps } from './DiscoverSidebar'
import './FilterOverlay.css'

export interface FilterOverlayProps extends Pick<
  DiscoverSidebarProps,
  'selectedSubtypes' | 'onSelectedSubtypesChange'
  | 'filters' | 'selectedLanguages' | 'activeVerification'
  | 'onFilterChange' | 'onSelectedLanguagesChange' | 'onVerificationToggle'
  | 'mode' | 'skillStatus' | 'onSkillStatusChange' | 'itemCounts'
> {
  open: boolean
  onClose: () => void
  initialTab?: 'languages' | 'types' | 'advanced'
}

export default function FilterOverlay(props: FilterOverlayProps) {
  const { open, onClose, initialTab = 'languages', ...rest } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'languages' | 'types' | 'advanced'>(initialTab)

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  const langCount = rest.selectedLanguages.length
  const typeCount = rest.selectedSubtypes.length
  const advCount  = (rest.filters.stars ? 1 : 0)
    + (rest.filters.activity ? 1 : 0)
    + (rest.filters.license ? 1 : 0)
    + rest.activeVerification.size

  return (
    <div ref={wrapRef} className="filter-overlay" role="dialog" aria-label="Filters">
      <div className="filter-overlay-tabs">
        <button
          className={`filter-overlay-tab${tab === 'languages' ? ' active' : ''}`}
          onClick={() => setTab('languages')}
        >
          Languages
          {langCount > 0 && <span className="filter-overlay-tab-badge">{langCount}</span>}
        </button>
        <button
          className={`filter-overlay-tab${tab === 'types' ? ' active' : ''}`}
          onClick={() => setTab('types')}
        >
          Types
          {typeCount > 0 && <span className="filter-overlay-tab-badge">{typeCount}</span>}
        </button>
        <button
          className={`filter-overlay-tab${tab === 'advanced' ? ' active' : ''}`}
          onClick={() => setTab('advanced')}
        >
          Advanced
          {advCount > 0 && <span className="filter-overlay-tab-badge">{advCount}</span>}
        </button>
      </div>
      <div className="filter-overlay-body">
        {(tab === 'languages' || tab === 'types') && (
          <FilterPanel
            selectedLanguages={rest.selectedLanguages}
            onSelectedLanguagesChange={rest.onSelectedLanguagesChange}
            selectedSubtypes={rest.selectedSubtypes}
            onSelectedSubtypesChange={rest.onSelectedSubtypesChange}
            itemCounts={rest.itemCounts}
            embedded
            activeTab={tab === 'languages' ? 'language' : 'type'}
          />
        )}
        {tab === 'advanced' && (
          <AdvancedPanel
            filters={rest.filters}
            activeVerification={rest.activeVerification}
            onFilterChange={rest.onFilterChange}
            onVerificationToggle={rest.onVerificationToggle}
            mode={rest.mode}
            skillStatus={rest.skillStatus}
            onSkillStatusChange={rest.onSkillStatusChange}
          />
        )}
      </div>
    </div>
  )
}
