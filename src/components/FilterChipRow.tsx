import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { LANG_MAP } from '../lib/languages'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import FilterOverlay from './FilterOverlay'
import type { SearchFilters } from './DiscoverSidebar'
import './FilterChipRow.css'

export interface FilterChipRowProps {
  selectedLanguages: string[]
  selectedSubtypes: string[]
  activeTags: string[]
  filters: SearchFilters
  activeVerification: Set<'verified' | 'likely'>

  onRemoveLanguage: (key: string) => void
  onRemoveSubtype: (id: string) => void
  onRemoveTag: (tag: string) => void
  onClearAdvanced: (key: 'stars' | 'activity' | 'license') => void
  onVerificationToggle: (tier: 'verified' | 'likely') => void

  onSelectedLanguagesChange: (keys: string[]) => void
  onSelectedSubtypesChange: (ids: string[]) => void
  onFilterChange: (filters: SearchFilters) => void
}

function langLabel(key: string): string {
  return LANG_MAP[key]?.name ?? key
}

function subtypeLabel(id: string): string {
  return getSubTypeConfig(id)?.label ?? id
}

function starsLabel(stars: number): string {
  return stars >= 1000 ? `${(stars / 1000).toFixed(0)},000+ stars` : `${stars}+ stars`
}

function activityLabel(a: 'week' | 'month' | 'halfyear'): string {
  return a === 'week' ? 'Active last 7 days' : a === 'month' ? 'Active last 30 days' : 'Active last 6 months'
}

export default function FilterChipRow(props: FilterChipRowProps) {
  const {
    selectedLanguages, selectedSubtypes, activeTags, filters, activeVerification,
    onRemoveLanguage, onRemoveSubtype, onRemoveTag, onClearAdvanced, onVerificationToggle,
    onSelectedLanguagesChange, onSelectedSubtypesChange, onFilterChange,
  } = props

  const [overlayOpen, setOverlayOpen] = useState(false)

  const hasChips =
    selectedLanguages.length > 0
    || selectedSubtypes.length > 0
    || activeTags.length > 0
    || !!filters.stars || !!filters.activity || !!filters.license
    || activeVerification.size > 0

  if (!hasChips && !overlayOpen) return null

  return (
    <div className="filter-chip-row">
      {selectedLanguages.map(key => (
        <span key={`lang-${key}`} className="filter-chip">
          {langLabel(key)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveLanguage(key)}
            aria-label={`Remove ${langLabel(key)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {selectedSubtypes.map(id => (
        <span key={`sub-${id}`} className="filter-chip">
          {subtypeLabel(id)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveSubtype(id)}
            aria-label={`Remove ${subtypeLabel(id)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {activeTags.map(tag => (
        <span key={`tag-${tag}`} className="filter-chip">
          {tag}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveTag(tag)}
            aria-label={`Remove ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {filters.stars && (
        <span className="filter-chip">
          {starsLabel(filters.stars)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('stars')}
            aria-label="Remove stars filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {filters.activity && (
        <span className="filter-chip">
          {activityLabel(filters.activity)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('activity')}
            aria-label="Remove activity filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {filters.license && (
        <span className="filter-chip">
          {filters.license.toUpperCase()}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('license')}
            aria-label="Remove license filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {activeVerification.has('verified') && (
        <span className="filter-chip">
          Verified
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onVerificationToggle('verified')}
            aria-label="Remove verified filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {activeVerification.has('likely') && (
        <span className="filter-chip">
          Likely Verified
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onVerificationToggle('likely')}
            aria-label="Remove likely-verified filter"
          >
            <X size={11} />
          </button>
        </span>
      )}

      <button
        type="button"
        className="filter-chip-add"
        onClick={() => setOverlayOpen(o => !o)}
      >
        <Plus size={11} />
        <span>Filter</span>
      </button>

      <FilterOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        selectedLanguages={selectedLanguages}
        onSelectedLanguagesChange={onSelectedLanguagesChange}
        selectedSubtypes={selectedSubtypes}
        onSelectedSubtypesChange={onSelectedSubtypesChange}
        filters={filters}
        activeVerification={activeVerification}
        onFilterChange={onFilterChange}
        onVerificationToggle={onVerificationToggle}
      />
    </div>
  )
}
