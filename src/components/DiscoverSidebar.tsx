import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { createPortal } from 'react-dom'
import {
  X, ShieldCheck, Shield, SlidersHorizontal, Search, ChevronDown, Star,
} from 'lucide-react'
import type { IconType } from 'react-icons'
import {
  PiCpuFill, PiAppleLogoFill, PiCircleHalfFill, PiGridFourFill,
  PiFunctionFill, PiBroadcastFill,
  PiBracketsCurlyFill, PiScrollFill, PiTerminalWindowFill, PiChartBarFill,
  PiAtomFill, PiFileCodeFill, PiPaletteFill, PiBookOpenFill,
  PiDatabaseFill, PiWrenchFill, PiLinkSimpleFill, PiCircuitryFill,
  PiGameControllerFill, PiBuildingsFill, PiPenNibFill, PiMonitorFill,
  PiBrainFill, PiGraduationCapFill, PiDesktopTowerFill, PiHardDrivesFill,
  PiStackFill,
  PiGlobeFill, PiDevicesFill, PiStarFill,
} from 'react-icons/pi'
import { FaJava } from 'react-icons/fa6'
import { SiJavascript } from 'react-icons/si'
import { REPO_BUCKETS } from '../constants/repoTypes'
import { LANG_CATEGORIES, getLangsByCategory, DOMAIN_CATEGORIES, getLangsByDomainCategory, LANG_MAP, getLangColor } from '../lib/languages'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import LanguageIcon from './LanguageIcon'
import logoSrc from '../assets/logo.png'
import './DiscoverSidebar.css'

/* ── Filled SVG icons (matching Dock style) ─────────── */

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  )
}

function BrowseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  )
}

function BlocksIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
    </svg>
  )
}

/* ── Types ───────────────────────────────────────────── */

export type ActivityFilter = 'week' | 'month' | 'halfyear'
export type StarsFilter = 100 | 1000 | 10000

export interface SearchFilters {
  activity?: ActivityFilter
  stars?: StarsFilter
  license?: string
}

export interface SkillStatusFilter {
  enhancedOnly: boolean
  componentsOnly: boolean
}

export interface DiscoverSidebarProps {
  // Buckets
  selectedSubtypes: string[]
  onSelectedSubtypesChange: (subtypes: string[]) => void

  // Filters
  filters: SearchFilters
  selectedLanguages: string[]
  activeVerification: Set<'verified' | 'likely'>
  onFilterChange: (filters: SearchFilters) => void
  onSelectedLanguagesChange: (langs: string[]) => void
  onVerificationToggle: (tier: 'verified' | 'likely') => void

  // Panel state (for snapshot save/restore)
  activePanel: 'buckets' | 'filters' | 'advanced' | null
  onActivePanelChange: (panel: 'buckets' | 'filters' | 'advanced' | null) => void

  // Navigation (optional — omit to hide Home button)
  showLanding?: boolean
  onHomeClick?: () => void
  onBrowseClick?: () => void

  // Search bar (optional — renders inline search when provided)
  query?: string
  onQueryChange?: (q: string) => void
  onSearch?: () => void
  inputRef?: React.RefObject<HTMLInputElement>

  // Layout controls (optional — renders grid/list/cog when provided)
  layoutPrefs?: import('./LayoutDropdown').LayoutPrefs
  onLayoutChange?: (prefs: import('./LayoutDropdown').LayoutPrefs) => void

  // Nav compact state (passed down from scroll tracking)
  compact?: boolean

  // Library mode extensions
  mode?: 'discover' | 'library'
  skillStatus?: SkillStatusFilter
  onSkillStatusChange?: (next: SkillStatusFilter) => void
  itemCounts?: {
    byBucket:   Map<string, number>
    byLanguage: Map<string, number>
  }
}

/* (Language categories come from ../lib/languages.ts) */

import type { LangCategory, DomainCategory, GroupingMode } from '../lib/languages'

const LANG_CAT_ICONS: Record<LangCategory, IconType> = {
  'Systems': PiCpuFill, 'JVM': FaJava, 'Apple': PiAppleLogoFill, '.NET': PiCircleHalfFill,
  'JavaScript': SiJavascript, 'Web Frameworks': PiGridFourFill, 'Functional': PiFunctionFill, 'BEAM': PiBroadcastFill,
  'Lisp': PiBracketsCurlyFill, 'Scripting': PiScrollFill, 'Shell': PiTerminalWindowFill, 'Data': PiChartBarFill,
  'Logic': PiAtomFill, 'Markup': PiFileCodeFill, 'Styling': PiPaletteFill, 'Typesetting': PiBookOpenFill,
  'Database': PiDatabaseFill, 'Config': PiWrenchFill, 'Blockchain': PiLinkSimpleFill, 'Hardware': PiCircuitryFill,
  'Game': PiGameControllerFill, 'Enterprise': PiBuildingsFill, 'Editor': PiPenNibFill, 'UI': PiMonitorFill,
}

const DOMAIN_CAT_ICONS: Record<DomainCategory, IconType> = {
  'Systems':          PiCpuFill,
  'Web':              PiGlobeFill,
  'Data & Science':   PiChartBarFill,
  'Functional':       PiFunctionFill,
  'Mobile & Desktop': PiDevicesFill,
  'DevOps & Config':  PiTerminalWindowFill,
  'Hardware':         PiCircuitryFill,
  'Specialty':        PiStarFill,
}

const BUCKET_NAV_ICONS: Record<string, IconType> = {
  'dev-tools': PiWrenchFill,
  'frameworks': PiGridFourFill,
  'ai-ml': PiBrainFill,
  'learning': PiGraduationCapFill,
  'editors': PiDesktopTowerFill,
  'lang-projects': PiBookOpenFill,
  'infrastructure': PiHardDrivesFill,
  'utilities': PiStackFill,
}

/* ── Stars / Activity / License options ──────────────── */

const STARS_OPTIONS: { label: string; value: StarsFilter | undefined }[] = [
  { label: 'Any',     value: undefined },
  { label: '100+',    value: 100 },
  { label: '1,000+',  value: 1000 },
  { label: '10,000+', value: 10000 },
]

const ACTIVITY_OPTIONS: { label: string; value: ActivityFilter | undefined }[] = [
  { label: 'Any',           value: undefined },
  { label: 'Last 7 days',   value: 'week' },
  { label: 'Last 30 days',  value: 'month' },
  { label: 'Last 6 months', value: 'halfyear' },
]

const LICENSE_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: 'Any',        value: undefined },
  { label: 'MIT',        value: 'mit' },
  { label: 'Apache 2.0', value: 'apache-2.0' },
  { label: 'GPL 3.0',   value: 'gpl-3.0' },
]

/* ── Filter tab type ────────────────────────────────── */

type FilterTab = 'language' | 'type'

/* ── Main Filter Panel (Language + Repo Type tabs) ──── */

export function FilterPanel({
  selectedLanguages,
  onSelectedLanguagesChange,
  selectedSubtypes,
  onSelectedSubtypesChange,
  itemCounts,
  embedded = false,
  activeTab: controlledActiveTab,
  search: controlledSearch,
}: Pick<DiscoverSidebarProps, 'selectedLanguages' | 'onSelectedLanguagesChange' | 'selectedSubtypes' | 'onSelectedSubtypesChange'> & {
  itemCounts?: DiscoverSidebarProps['itemCounts']
  embedded?: boolean
  activeTab?: FilterTab
  search?: string
}) {
  const [internalActiveTab, setActiveTab] = useState<FilterTab>('language')
  const activeTab = controlledActiveTab ?? internalActiveTab
  const [internalSearch, setSearch] = useState('')
  const search = controlledSearch ?? internalSearch
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [groupingMode, setGroupingMode] = useLocalStorage<GroupingMode>('discover:languageGrouping', 'domain')

  // ── Draft state — selections are staged locally until the user clicks Apply ──
  const [draftLanguages, setDraftLanguages] = useState(selectedLanguages)
  const [draftSubtypes, setDraftSubtypes] = useState(selectedSubtypes)

  // Sync draft when committed values change externally (e.g. chip removal from GridHeader)
  const committedLangsKey = selectedLanguages.slice().sort().join(',')
  const committedTypesKey = selectedSubtypes.slice().sort().join(',')
  useEffect(() => { setDraftLanguages(selectedLanguages) }, [committedLangsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraftSubtypes(selectedSubtypes) }, [committedTypesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const langsDirty = draftLanguages.slice().sort().join(',') !== committedLangsKey
  const typesDirty = draftSubtypes.slice().sort().join(',') !== committedTypesKey

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  // Favourites
  const [favLangs, setFavLangs] = useState<Set<string>>(new Set())
  const [favTypes, setFavTypes] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.settings.get('fav_languages').then((v: string | null) => {
      if (v) setFavLangs(new Set(JSON.parse(v)))
    }).catch(() => {})
    window.api.settings.get('fav_subtypes').then((v: string | null) => {
      if (v) setFavTypes(new Set(JSON.parse(v)))
    }).catch(() => {})
  }, [])

  const toggleFavLang = (key: string) => {
    setFavLangs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      if (next.size === 0 && activeCategory === '_fav') setActiveCategory(null)
      window.api.settings.set('fav_languages', JSON.stringify([...next])).catch(() => {})
      return next
    })
  }

  const toggleFavType = (id: string) => {
    setFavTypes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0 && activeCategory === '_fav') setActiveCategory(null)
      window.api.settings.set('fav_subtypes', JSON.stringify([...next])).catch(() => {})
      return next
    })
  }

  const toggleLanguage = (key: string) => {
    setDraftLanguages(prev =>
      prev.includes(key) ? prev.filter(l => l !== key) : [...prev, key],
    )
  }

  const toggleSubtype = (id: string) => {
    setDraftSubtypes(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id],
    )
  }

  const labelMap = new Map<string, { label: string; color: string }>()
  for (const bucket of REPO_BUCKETS) {
    for (const st of bucket.subTypes) {
      labelMap.set(st.id, { label: st.label, color: bucket.color })
    }
  }

  const hasFavs = activeTab === 'language' ? favLangs.size > 0 : favTypes.size > 0

  return (
    <div className="discover-panel-content">
      {/* Sticky header: title + search + tabs + category dropdown */}
      {!embedded && (
      <div className="blocks-sticky-header">
      <div className="blocks-header">
        <div className="blocks-title">Blocks</div>
        <div className="blocks-search">
          <Search size={12} />
          <input
            type="text"
            placeholder={activeTab === 'language' ? 'Search languages...' : 'Search types...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="panel-tab-bar">
        <button className={`panel-tab${activeTab === 'language' ? ' active' : ''}`} onClick={() => { setActiveTab('language'); setSearch(''); setActiveCategory(null); setDropdownOpen(false) }}>
          Language{draftLanguages.length > 0 ? ` (${draftLanguages.length})` : ''}
        </button>
        <button className={`panel-tab${activeTab === 'type' ? ' active' : ''}`} onClick={() => { setActiveTab('type'); setSearch(''); setActiveCategory(null); setDropdownOpen(false) }}>
          Type{draftSubtypes.length > 0 ? ` (${draftSubtypes.length})` : ''}
        </button>
      </div>

      {/* Category filter dropdown */}
      {(() => {
        const currentCat = activeCategory && activeCategory !== '_fav' ? activeCategory : null
        const TriggerIcon = activeTab === 'language'
          ? (currentCat ? LANG_CAT_ICONS[currentCat as LangCategory] : null)
          : (currentCat ? BUCKET_NAV_ICONS[currentCat] : null)
        const triggerLabel = activeTab === 'language'
          ? (currentCat ?? 'All Languages')
          : (currentCat ? REPO_BUCKETS.find(b => b.id === currentCat)?.label ?? currentCat : 'All Types')

        return (
          <div className="category-filter-row">
            {hasFavs && (
              <button
                className={`category-fav-btn${activeCategory === '_fav' ? ' active' : ''}`}
                onClick={() => { setActiveCategory(activeCategory === '_fav' ? null : '_fav'); setDropdownOpen(false) }}
                title="Favourites"
              >
                <Star size={12} />
              </button>
            )}
            <div className="category-dropdown" ref={dropdownRef}>
              <button
                className={`category-dropdown-trigger${dropdownOpen ? ' open' : ''}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <span className="category-dropdown-value">
                  {TriggerIcon && <TriggerIcon size={12} />}
                  {triggerLabel}
                </span>
                <ChevronDown size={10} className="category-dropdown-chevron" />
              </button>
              {dropdownOpen && (
                <div className="category-dropdown-menu">
                  <button
                    className={`category-dropdown-item${!currentCat ? ' active' : ''}`}
                    onClick={() => { setActiveCategory(null); setDropdownOpen(false) }}
                  >
                    {activeTab === 'language' ? 'All Languages' : 'All Types'}
                  </button>
                  {activeTab === 'language'
                    ? LANG_CATEGORIES.map(cat => {
                        const CatIcon = LANG_CAT_ICONS[cat]
                        return (
                          <button
                            key={cat}
                            className={`category-dropdown-item${currentCat === cat ? ' active' : ''}`}
                            onClick={() => { setActiveCategory(cat); setDropdownOpen(false) }}
                          >
                            <CatIcon size={12} />
                            {cat}
                          </button>
                        )
                      })
                    : REPO_BUCKETS.map(bucket => {
                        const BIcon = BUCKET_NAV_ICONS[bucket.id]
                        return (
                          <button
                            key={bucket.id}
                            className={`category-dropdown-item${currentCat === bucket.id ? ' active' : ''}`}
                            onClick={() => { setActiveCategory(bucket.id); setDropdownOpen(false) }}
                          >
                            {BIcon && <BIcon size={12} />}
                            {bucket.label}
                          </button>
                        )
                      })
                  }
                </div>
              )}
            </div>
          </div>
        )
      })()}
      </div>
      )}{/* end blocks-sticky-header */}

      {/* Language tab */}
      {activeTab === 'language' && (
        <>
          <div className="filter-grouping-toggle">
            <button
              className={`filter-grouping-btn${groupingMode === 'domain' ? ' active' : ''}`}
              onClick={() => setGroupingMode('domain')}
            >
              Domain
            </button>
            <button
              className={`filter-grouping-btn${groupingMode === 'ecosystem' ? ' active' : ''}`}
              onClick={() => setGroupingMode('ecosystem')}
            >
              Ecosystem
            </button>
          </div>
          <div className={`categories-grid categories-grid--lang categories-grid--lang-${groupingMode}`}>
          {/* Favourites section */}
          {favLangs.size > 0 && (!activeCategory || activeCategory === '_fav') && !search && (
            <div className="bucket-group">
              <div className="bucket-label"><Star size={11} /> Favourites</div>
              {[...favLangs].map(key => {
                const def = LANG_MAP.get(key)
                if (!def) return null
                const selected = draftLanguages.includes(def.key)
                return (
                  <button
                    key={def.key}
                    className={`subtype-row${selected ? ' selected' : ''}`}
                    style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
                    onClick={() => toggleLanguage(def.key)}
                  >
                    <span className="subtype-star starred" onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}>
                      <Star size={10} />
                    </span>
                    <LanguageIcon lang={def.key} size={16} boxed />
                    <span className="subtype-label">{def.name}</span>
                  </button>
                )
              })}
            </div>
          )}
          {groupingMode === 'domain'
            ? DOMAIN_CATEGORIES.map(cat => {
                const langs = getLangsByDomainCategory(cat)
                  .filter(def => !search || def.name.toLowerCase().includes(search.toLowerCase()))
                  .filter(def => !itemCounts || (itemCounts.byLanguage.get(def.key) ?? 0) > 0)
                if (!langs.length) return null
                const CatIcon = DOMAIN_CAT_ICONS[cat]
                return (
                  <div key={cat} className="bucket-group">
                    <div className="bucket-label"><CatIcon size={11} /> {cat}</div>
                    {langs.map(def => {
                      const selected = draftLanguages.includes(def.key)
                      const isFav = favLangs.has(def.key)
                      const langCount = itemCounts?.byLanguage.get(def.key)
                      return (
                        <button
                          key={def.key}
                          className={`subtype-row${selected ? ' selected' : ''}`}
                          style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
                          onClick={() => toggleLanguage(def.key)}
                        >
                          <span className={`subtype-star${isFav ? ' starred' : ''}`} onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}>
                            <Star size={10} />
                          </span>
                          <LanguageIcon lang={def.key} size={16} boxed />
                          <span className="subtype-label">
                            {def.name}{langCount != null && ` (${langCount})`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            : LANG_CATEGORIES
                .filter(cat => !activeCategory || (activeCategory !== '_fav' && activeCategory === cat))
                .map(cat => {
                const langs = getLangsByCategory(cat)
                  .filter(def => !search || def.name.toLowerCase().includes(search.toLowerCase()))
                  .filter(def => !itemCounts || (itemCounts.byLanguage.get(def.key) ?? 0) > 0)
                if (!langs.length) return null
                const CatIcon = LANG_CAT_ICONS[cat]
                return (
                  <div key={cat} className="bucket-group">
                    <div className="bucket-label"><CatIcon size={11} /> {cat}</div>
                    {langs.map(def => {
                      const selected = draftLanguages.includes(def.key)
                      const isFav = favLangs.has(def.key)
                      const langCount = itemCounts?.byLanguage.get(def.key)
                      return (
                        <button
                          key={def.key}
                          className={`subtype-row${selected ? ' selected' : ''}`}
                          style={{ '--row-color': getLangColor(def.key) } as React.CSSProperties}
                          onClick={() => toggleLanguage(def.key)}
                        >
                          <span className={`subtype-star${isFav ? ' starred' : ''}`} onClick={e => { e.stopPropagation(); toggleFavLang(def.key) }}>
                            <Star size={10} />
                          </span>
                          <LanguageIcon lang={def.key} size={16} boxed />
                          <span className="subtype-label">
                            {def.name}{langCount != null && ` (${langCount})`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
          }
          </div>

          {(draftLanguages.length > 0 || langsDirty) && (
            <div className="discover-panel-summary">
              {draftLanguages.length > 0 && (
                <>
                  <span className="discover-panel-summary-count">{draftLanguages.length} selected</span>
                  <div className="discover-panel-summary-chips">
                    {draftLanguages.map(key => {
                      const def = LANG_MAP.get(key)
                      return (
                        <span key={key} className="summary-chip" style={{ '--chip-color': getLangColor(key) } as React.CSSProperties}>
                          <span className="summary-chip-icon">
                            <LanguageIcon lang={key} size={12} boxed />
                          </span>
                          <span className="summary-chip-label">{def?.name ?? key}</span>
                          <button className="chip-x" onClick={() => toggleLanguage(key)}>
                            <X size={10} />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </>
              )}
              <div className="discover-panel-summary-actions">
                {draftLanguages.length > 0 && (
                  <button className="discover-panel-clear-all" onClick={() => setDraftLanguages([])}>
                    Clear all
                  </button>
                )}
                {langsDirty && (
                  <button className="discover-panel-apply" onClick={() => onSelectedLanguagesChange(draftLanguages)}>
                    Apply
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Repo Type tab */}
      {activeTab === 'type' && (
        <>
          <div className="categories-grid">
          {/* Favourites section */}
          {favTypes.size > 0 && (!activeCategory || activeCategory === '_fav') && !search && (
            <div className="bucket-group">
              <div className="bucket-label"><Star size={11} /> Favourites</div>
              {[...favTypes].map(id => {
                const cfg = getSubTypeConfig(id)
                if (!cfg) return null
                const selected = draftSubtypes.includes(id)
                return (
                  <button
                    key={id}
                    className={`subtype-row${selected ? ' selected' : ''}`}
                    style={{ '--row-color': cfg.accentColor } as React.CSSProperties}
                    onClick={() => toggleSubtype(id)}
                  >
                    <span className="subtype-star starred" onClick={e => { e.stopPropagation(); toggleFavType(id) }}>
                      <Star size={10} />
                    </span>
                    {cfg.icon ? (
                      <span className="subtype-icon-box" style={{ backgroundColor: cfg.accentColor }}>
                        <cfg.icon size={12} fill="#fff" stroke="#fff" strokeWidth={0.75} />
                      </span>
                    ) : (
                      <span className="subtype-dot" style={{ background: cfg.accentColor }} />
                    )}
                    <span className="subtype-label">{cfg.label}</span>
                  </button>
                )
              })}
            </div>
          )}
          {REPO_BUCKETS
            .filter(bucket => !activeCategory || (activeCategory !== '_fav' && activeCategory === bucket.id))
            .filter(bucket => !itemCounts || (itemCounts.byBucket.get(bucket.id) ?? 0) > 0)
            .map(bucket => {
            const filtered = bucket.subTypes.filter(st =>
              !search || st.label.toLowerCase().includes(search.toLowerCase())
            )
            if (!filtered.length) return null
            const BIcon = BUCKET_NAV_ICONS[bucket.id]
            const count = itemCounts?.byBucket.get(bucket.id)
            return (
            <div key={bucket.id} className="bucket-group">
              <div className="bucket-label">
                {BIcon && <BIcon size={11} />} {bucket.label}
                {count != null && ` (${count})`}
              </div>
              {filtered.map(st => {
                const selected = draftSubtypes.includes(st.id)
                const cfg = getSubTypeConfig(st.id)
                const isFav = favTypes.has(st.id)
                return (
                  <button
                    key={st.id}
                    className={`subtype-row${selected ? ' selected' : ''}`}
                    style={{ '--row-color': bucket.color } as React.CSSProperties}
                    onClick={() => toggleSubtype(st.id)}
                  >
                    <span className={`subtype-star${isFav ? ' starred' : ''}`} onClick={e => { e.stopPropagation(); toggleFavType(st.id) }}>
                      <Star size={10} />
                    </span>
                    {cfg?.icon ? (
                      <span className="subtype-icon-box" style={{ backgroundColor: bucket.color }}>
                        <cfg.icon size={12} fill="#fff" stroke="#fff" strokeWidth={0.75} />
                      </span>
                    ) : (
                      <span className="subtype-dot" style={{ background: bucket.color }} />
                    )}
                    <span className="subtype-label">{st.label}</span>
                  </button>
                )
              })}
            </div>
            )
          })}
          </div>

          {(draftSubtypes.length > 0 || typesDirty) && (
            <div className="discover-panel-summary">
              {draftSubtypes.length > 0 && (
                <>
                  <span className="discover-panel-summary-count">{draftSubtypes.length} selected</span>
                  <div className="discover-panel-summary-chips">
                    {draftSubtypes.map(id => {
                      const info = labelMap.get(id)
                      const cfg = getSubTypeConfig(id)
                      return (
                        <span key={id} className="summary-chip" style={{ '--chip-color': info?.color } as React.CSSProperties}>
                          {cfg?.icon && (
                            <span className="summary-chip-icon">
                              <cfg.icon size={12} fill="#fff" stroke="#fff" strokeWidth={0.75} />
                            </span>
                          )}
                          <span className="summary-chip-label">{info?.label ?? id}</span>
                          <button className="chip-x" onClick={() => toggleSubtype(id)}>
                            <X size={10} />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </>
              )}
              <div className="discover-panel-summary-actions">
                {draftSubtypes.length > 0 && (
                  <button className="discover-panel-clear-all" onClick={() => setDraftSubtypes([])}>
                    Clear all
                  </button>
                )}
                {typesDirty && (
                  <button className="discover-panel-apply" onClick={() => onSelectedSubtypesChange(draftSubtypes)}>
                    Apply
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

    </div>
  )
}

/* ── Advanced Filters Panel ─────────────────────────── */

export function AdvancedPanel({
  filters,
  activeVerification,
  onFilterChange,
  onVerificationToggle,
  mode,
  skillStatus,
  onSkillStatusChange,
}: Pick<DiscoverSidebarProps, 'filters' | 'activeVerification' | 'onFilterChange' | 'onVerificationToggle'> & {
  mode: 'discover' | 'library'
  skillStatus?: SkillStatusFilter
  onSkillStatusChange?: (next: SkillStatusFilter) => void
}) {
  const activeCount =
    (mode === 'discover' && filters.stars    ? 1 : 0) +
    (mode === 'discover' && filters.activity ? 1 : 0) +
    (mode === 'discover' && filters.license  ? 1 : 0) +
    activeVerification.size +
    (skillStatus?.enhancedOnly ? 1 : 0) +
    (skillStatus?.componentsOnly ? 1 : 0)

  const clearAll = () => {
    onFilterChange({})
    activeVerification.forEach(tier => onVerificationToggle(tier))
    if (mode === 'library' && onSkillStatusChange) {
      onSkillStatusChange({ enhancedOnly: false, componentsOnly: false })
    }
  }

  return (
    <div className="discover-panel-content">
      <div className="discover-panel-header">Advanced Filters</div>

      {/* Stars / Activity / License — discover mode only */}
      {mode === 'discover' && (
        <>
          {/* Stars */}
          <div className="filter-section">
            <div className="filter-section-label">Stars</div>
            <div className="radio-list">
              {STARS_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  className={`radio-item${filters.stars === opt.value ? ' active' : ''}`}
                  onClick={() => onFilterChange({ ...filters, stars: opt.value })}
                >
                  <span className={`radio-dot${filters.stars === opt.value ? ' active' : ''}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="filter-section">
            <div className="filter-section-label">Activity</div>
            <div className="radio-list">
              {ACTIVITY_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  className={`radio-item${filters.activity === opt.value ? ' active' : ''}`}
                  onClick={() => onFilterChange({ ...filters, activity: opt.value })}
                >
                  <span className={`radio-dot${filters.activity === opt.value ? ' active' : ''}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* License */}
          <div className="filter-section">
            <div className="filter-section-label">License</div>
            <div className="radio-list">
              {LICENSE_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  className={`radio-item${filters.license === opt.value ? ' active' : ''}`}
                  onClick={() => onFilterChange({ ...filters, license: opt.value })}
                >
                  <span className={`radio-dot${filters.license === opt.value ? ' active' : ''}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Verification */}
      <div className="filter-section">
        <div className="filter-section-label">Verification</div>
        <div className="radio-list">
          <button
            className={`radio-item checkbox${activeVerification.has('verified') ? ' active' : ''}`}
            onClick={() => onVerificationToggle('verified')}
          >
            <span className={`check-box${activeVerification.has('verified') ? ' active' : ''}`}>
              {activeVerification.has('verified') && <ShieldCheck size={10} />}
            </span>
            Official
          </button>
          <button
            className={`radio-item checkbox${activeVerification.has('likely') ? ' active' : ''}`}
            onClick={() => onVerificationToggle('likely')}
          >
            <span className={`check-box${activeVerification.has('likely') ? ' active' : ''}`}>
              {activeVerification.has('likely') && <Shield size={10} />}
            </span>
            Likely Official
          </button>
        </div>
      </div>

      {/* Skill Status — library mode only */}
      {mode === 'library' && skillStatus && onSkillStatusChange && (
        <div className="filter-section skill-status-section">
          <div className="filter-section-label">Skill Status</div>
          <div className="radio-list">
            <button
              className={`radio-item checkbox${skillStatus.enhancedOnly ? ' active' : ''}`}
              onClick={() => onSkillStatusChange({ ...skillStatus, enhancedOnly: !skillStatus.enhancedOnly })}
            >
              <span className={`check-box${skillStatus.enhancedOnly ? ' active' : ''}`}>
                {skillStatus.enhancedOnly && <span style={{ fontSize: 10 }}>&#10003;</span>}
              </span>
              Enhanced (Tier 2)
            </button>
            <button
              className={`radio-item checkbox${skillStatus.componentsOnly ? ' active' : ''}`}
              onClick={() => onSkillStatusChange({ ...skillStatus, componentsOnly: !skillStatus.componentsOnly })}
            >
              <span className={`check-box${skillStatus.componentsOnly ? ' active' : ''}`}>
                {skillStatus.componentsOnly && <span style={{ fontSize: 10 }}>&#10003;</span>}
              </span>
              Components available
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      {activeCount > 0 && (
        <div className="discover-panel-summary">
          <span className="discover-panel-summary-count">
            {activeCount} filter{activeCount !== 1 ? 's' : ''} active
          </span>
          <button className="discover-panel-clear-all" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}

/* ── DiscoverSidebar ─────────────────────────────────── */

export default function DiscoverSidebar({
  selectedSubtypes,
  onSelectedSubtypesChange,
  filters,
  selectedLanguages,
  activeVerification,
  onFilterChange,
  onSelectedLanguagesChange,
  onVerificationToggle,
  activePanel,
  onActivePanelChange,
  showLanding,
  onHomeClick,
  onBrowseClick,
  mode = 'discover',
  skillStatus,
  onSkillStatusChange,
  itemCounts,
}: DiscoverSidebarProps) {
  const togglePanel = (panel: 'filters' | 'advanced') => {
    onActivePanelChange(activePanel === panel ? null : panel)
  }

  const filterCount = selectedLanguages.length + selectedSubtypes.length
  const hasFilterSelections = filterCount > 0
  const advancedCount = (filters.stars ? 1 : 0) + (filters.activity ? 1 : 0) + (filters.license ? 1 : 0) + activeVerification.size
  const hasAdvancedSelections = advancedCount > 0

  const [railTip, setRailTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const showRailTip = useCallback((text: string, e: React.MouseEvent) => {
    setRailTip({ text, x: e.clientX, y: e.clientY })
  }, [])
  const moveRailTip = useCallback((e: React.MouseEvent) => {
    setRailTip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
  }, [])
  const hideRailTip = useCallback(() => setRailTip(null), [])

  // Close panel on click outside sidebar
  const railRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activePanel) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (!railRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        onActivePanelChange(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [activePanel, onActivePanelChange])

  return (
    <>
      {/* Icon rail */}
      <div ref={railRef} className="sidebar-rail">
        <img src={logoSrc} alt="Git Suite" className="rail-logo" />

        <button
          className="rail-icon rail-icon-active"
          onMouseEnter={e => showRailTip('Browse', e)}
          onMouseMove={moveRailTip}
          onMouseLeave={hideRailTip}
        >
          <BrowseIcon />
        </button>

        <span className="rail-divider" />

        <button
          className={`rail-icon${activePanel === 'filters' ? ' rail-icon-active' : ''}`}
          onClick={() => togglePanel('filters')}
          onMouseEnter={e => showRailTip('Blocks', e)}
          onMouseMove={moveRailTip}
          onMouseLeave={hideRailTip}
        >
          <BlocksIcon />
          {activePanel !== 'filters' && hasFilterSelections && (
            <span className="rail-badge">{filterCount}</span>
          )}
        </button>

        <button
          className={`rail-icon${activePanel === 'advanced' ? ' rail-icon-active' : ''}`}
          onClick={() => togglePanel('advanced')}
          onMouseEnter={e => showRailTip('Advanced', e)}
          onMouseMove={moveRailTip}
          onMouseLeave={hideRailTip}
        >
          <SlidersHorizontal size={20} />
          {activePanel !== 'advanced' && hasAdvancedSelections && (
            <span className="rail-badge">{advancedCount}</span>
          )}
        </button>
      </div>

      {/* Panel */}
      <div ref={panelRef} className={`discover-panel${activePanel ? '' : ' collapsed'}`}>
        {activePanel === 'filters' && (
          <FilterPanel
            selectedLanguages={selectedLanguages}
            onSelectedLanguagesChange={onSelectedLanguagesChange}
            selectedSubtypes={selectedSubtypes}
            onSelectedSubtypesChange={onSelectedSubtypesChange}
            itemCounts={itemCounts}
          />
        )}
        {activePanel === 'advanced' && (
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
      </div>

      {/* Cursor-following rail tooltip */}
      {railTip && createPortal(
        <div className="blocks-tooltip" style={{ left: railTip.x, top: railTip.y }}>
          {railTip.text}
        </div>,
        document.body,
      )}
    </>
  )
}
