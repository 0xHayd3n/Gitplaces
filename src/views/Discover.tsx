import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useNavigationType, useSearchParams, useLocation } from 'react-router-dom'
import { useSearch } from '../contexts/Search'
import { type RepoRow } from '../types/repo'
import type { RecommendationItem } from '../types/recommendation'
import { saveDiscoverSnapshot, peekDiscoverSnapshot, popDiscoverSnapshot } from '../lib/discoverStateStore'
import { detectSearchMode } from '../services/search-mode'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import { LANGUAGES } from '../lib/languages'
import { classifyRepoBucket } from '../lib/classifyRepoType'
import { REPO_BUCKETS } from '../constants/repoTypes'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import { type SearchFilters } from '../components/DiscoverSidebar'
import DiscoverTopNav from '../components/DiscoverTopNav'
import DiscoverHero from '../components/DiscoverHero'
import DiscoverRow from '../components/DiscoverRow'
import DiscoverRowRepoCard from '../components/DiscoverRowRepoCard'
import DiscoverRowAgentCard from '../components/DiscoverRowAgentCard'
import FilterChipRow from '../components/FilterChipRow'
import AiChatOverlay from '../components/AiChatOverlay'
import { rankAgents } from '../lib/agentRanking'
import type { AgentRow } from '../types/agent'
import { useVerification } from '../hooks/useVerification'
import { useSearchHistory } from '../hooks/useSearchHistory'
import {
  DEFAULT_LAYOUT_PREFS, LAYOUT_STORAGE_KEY,
  type LayoutPrefs,
} from '../components/LayoutDropdown'
import {
  type ViewModeKey,
  buildViewModeQuery, getViewModeSort, getSubTypeKeyword,
} from '../lib/discoverQueries'
import DiscoverSuggestions, { type Suggestion, type SubtypeSuggestion, type TopicSuggestion } from '../components/DiscoverSuggestions'
import DiscoverGrid from '../components/DiscoverGrid'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { setDitherScrollHint } from '../hooks/useBayerDither'
import {
  loadCachedPopular, saveCachedPopular,
  loadCachedRecommended, saveCachedRecommended,
} from '../lib/discoverCache'

// ── Layout prefs loader ───────────────────────────────────────────

function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT_PREFS
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>
    const columns = Math.min(8, Math.max(4, parsed.columns ?? DEFAULT_LAYOUT_PREFS.columns))
    return {
      mode:    parsed.mode === 'list' ? 'list' : 'grid',
      columns,
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      fields: {
        description:  parsed.fields?.description  ?? true,
        tags:         parsed.fields?.tags         ?? true,
        stats:        parsed.fields?.stats        ?? true,
        type:         parsed.fields?.type         ?? true,
        verification: parsed.fields?.verification ?? true,
      },
    }
  } catch {
    return DEFAULT_LAYOUT_PREFS
  }
}

// ── Module-level caches (survive component unmount and app restart) ──
// RECOMMENDED_TTL_MS gates *in-session* refresh: hits within the hour skip
// the network. Persistent localStorage hydration uses its own 24h TTL inside
// loadCachedRecommended/Popular, so older-than-1h cache still seeds the UI
// (SWR-style) but triggers a background refetch.
const RECOMMENDED_TTL_MS = 60 * 60 * 1000

let _recommendedModuleCache: { items: RecommendationItem[]; fetchedAt: number } | null = (() => {
  const persisted = loadCachedRecommended()
  return persisted ? { items: persisted.items, fetchedAt: persisted.fetchedAt } : null
})()

let _popularModuleCache: { repos: RepoRow[]; fetchedAt: number } | null = (() => {
  const persisted = loadCachedPopular()
  return persisted ? { repos: persisted.repos, fetchedAt: persisted.fetchedAt } : null
})()

// Only the unfiltered "Most Popular" landing is cached — caching every filter
// permutation would bloat localStorage without meaningfully improving cold-start
// UX. Filtered views still hit the network.
function isPopularDefaultState(
  viewMode: ViewModeKey,
  selectedLanguages: string[],
  selectedSubtypes: string[],
  filters: SearchFilters,
): boolean {
  return viewMode === 'home'
    && selectedLanguages.length === 0
    && selectedSubtypes.length === 0
    && !filters.activity
    && !filters.stars
    && !filters.license
}

// ── Discover view ─────────────────────────────────────────────────
export default function Discover() {
  const navigationType = useNavigationType()
  const { query: contextQuery, setQuery: setContextQuery } = useSearch()
  const topNavInputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const restoredSnapshot = useRef(navigationType === 'POP' ? peekDiscoverSnapshot() : null)
  const restoredFromSnapshot = useRef(restoredSnapshot.current !== null)

  const [repos, setRepos] = useState<RepoRow[]>(() => {
    if (restoredSnapshot.current?.repos?.length) return restoredSnapshot.current.repos
    // Seed from persistent cache only when the URL describes a default-popular
    // landing — any filter param means the cache is for the wrong query.
    // Use the router-aware searchParams (not window.location) so any non-browser
    // router setup wouldn't silently disagree with the rest of the component.
    const view = searchParams.get('view')
    const isDefaultUrl = (view === null || view === 'home') && !searchParams.get('lang')
    if (isDefaultUrl && _popularModuleCache) return _popularModuleCache.repos
    return []
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recommendedCache = useRef<RepoRow[] | null>(null)
  const recommendedItemsCache = useRef<RecommendationItem[] | null>(null)
  const [rowRepos, setRowRepos] = useState<RepoRow[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)
  const [rankedAgents, setRankedAgents] = useState<AgentRow[]>([])
  const viewMode: ViewModeKey = (() => {
    const v = searchParams.get('view')
    if (v === 'recommended') return 'recommended'
    if (v === 'agents') return 'agents'
    return 'home'
  })()
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() => {
    const snap = restoredSnapshot.current
    if (snap?.selectedLanguages) return snap.selectedLanguages
    // backward compat: old snapshots stored a single activeLanguage string
    if ((snap as any)?.activeLanguage) return [(snap as any).activeLanguage]
    return []
  })
  const [discoverQuery, setDiscoverQuery] = useState(() => restoredSnapshot.current?.query ?? '')
  const [mode, setMode] = useState<'raw' | 'natural'>(() => restoredSnapshot.current?.mode ?? 'raw')
  const [detectedTags, setDetectedTags] = useState<string[]>(() => restoredSnapshot.current?.detectedTags ?? [])
  const [activeTags, setActiveTags] = useState<string[]>(() => restoredSnapshot.current?.activeTags ?? [])
  const [relatedTags, setRelatedTags] = useState<string[]>(() => restoredSnapshot.current?.relatedTags ?? [])
  const [topicMode, setTopicMode] = useState(() => restoredSnapshot.current?.topicMode ?? false)
  const [analysing, setAnalysing] = useState(false)
  const [allTopics, setAllTopics] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Filter panel
  const [appliedFilters, setAppliedFilters] = useState<SearchFilters>(() => restoredSnapshot.current?.appliedFilters ?? {})
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>(
    () => restoredSnapshot.current?.selectedSubtypes ?? []
  )
  const [activePanel, setActivePanel] = useState<'buckets' | 'filters' | 'advanced' | null>(
    () => restoredSnapshot.current?.activePanel ?? null
  )
  const [aiChatVisible, setAiChatVisible] = useState(false)
  const [aiInitialQuery, setAiInitialQuery] = useState<string | undefined>()
  const searchHistory = useSearchHistory()
  const showHistory = showSuggestions && discoverQuery.trim() === '' && searchHistory.entries.length > 0

  const discoverInputRef = topNavInputRef

  const ensureClassified = useCallback((repos: RepoRow[]) => {
    for (const r of repos) {
      if (!r.type_bucket) {
        const result = classifyRepoBucket(r)
        if (result) {
          r.type_bucket = result.bucket
          r.type_sub = result.subType
        }
      }
    }
  }, [])
  const [activeVerification, setActiveVerification] = useState<Set<'verified' | 'likely'>>(new Set())

  const handleVerificationToggle = (tier: 'verified' | 'likely') => {
    setActiveVerification(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })
  }

  const [layoutPrefs, setLayoutPrefs] = useState<LayoutPrefs>(loadLayoutPrefs)

  // Halve grid columns when window is narrow (split-screen).
  // ResizeObserver on the scroll container fires reliably on Windows snap,
  // unlike window.resize which can miss Electron snap events.
  const screenHalf = Math.round(window.screen.availWidth / 2)
  const narrowThreshold = Math.max(1200, screenHalf + 50)
  const [navCompact, setNavCompact] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [containerWidth, setContainerWidth] = useState(window.innerWidth)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setContainerWidth(Math.floor(entries[0].contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, []) // observer stays for lifetime of component
  const isNarrow = containerWidth > 0 && containerWidth <= narrowThreshold
  const effectiveCols = isNarrow
    ? Math.max(2, Math.round(layoutPrefs.columns / 2))
    : layoutPrefs.columns
  const effectiveLayoutPrefs = useMemo(
    () => ({ ...layoutPrefs, columns: effectiveCols }),
    [layoutPrefs, effectiveCols],
  )
  const [page, setPage] = useState(() => restoredSnapshot.current?.page ?? 1)
  const [hasMore, setHasMore] = useState(() => restoredSnapshot.current?.hasMore ?? true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchPath, setSearchPath] = useState<'trending' | 'raw' | 'tagged'>(
    () => restoredSnapshot.current?.searchPath ?? 'trending'
  )
  const fetchGeneration = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<() => void>(() => {})
  const allVisibleLengthRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const loadingRef = useRef(false)

  const RENDER_CHUNK = 20
  const [renderLimit, setRenderLimit] = useState(RENDER_CHUNK)
  const renderLimitRef = useRef(renderLimit)

  const handleLayoutChange = (prefs: LayoutPrefs) => {
    setLayoutPrefs(prefs)
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs))
  }

  const verification = useVerification()

  useEffect(() => {
    if (repos.length) {
      verification.seedFromDb(repos.map(r => r.id).filter(Boolean))
    }
  }, [repos])

  const gridRef = useRef<HTMLDivElement>(null)

  const suggestionsRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyDownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const blurHandlerRef = useRef<(e: FocusEvent) => void>(() => {})
  const focusHandlerRef = useRef<(e: FocusEvent) => void>(() => {})
  const navigate = useNavigate()
  const location = useLocation()
  const { openProfile } = useProfileOverlay()

  useLayoutEffect(() => {
    const snap = restoredSnapshot.current
    if (snap && scrollRef.current) {
      scrollRef.current.scrollTop = snap.scrollTop
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { popDiscoverSnapshot() }, [])

  useEffect(() => {
    async function loadHeroData() {
      // SWR: render any cached items now (the persistent cache may be older
      // than RECOMMENDED_TTL_MS but is still useful for instant cold-start),
      // then refresh in the background unless the in-session TTL says we're
      // already fresh enough to skip the network call.
      const cached = recommendedItemsCache.current ?? _recommendedModuleCache?.items ?? null
      if (cached) {
        recommendedItemsCache.current = cached
        recommendedCache.current = cached.map(i => i.repo)
        setRowRepos(cached.slice(0, 16).map(i => i.repo))
      }

      const isFreshInSession = _recommendedModuleCache
        && Date.now() - _recommendedModuleCache.fetchedAt < RECOMMENDED_TTL_MS
      if (cached && isFreshInSession) return

      try {
        const response = await window.api.github.getRecommended()
        const items = response.items
        _recommendedModuleCache = { items, fetchedAt: Date.now() }
        saveCachedRecommended(items)
        recommendedItemsCache.current = items
        recommendedCache.current = items.map(i => i.repo)
        setRowRepos(items.slice(0, 16).map(i => i.repo))
      } catch {
        // non-critical — hero/row simply won't render
      }
    }
    loadHeroData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (heroPaused || rowRepos.length < 2) return
    const timer = setInterval(() => {
      setHeroIndex(i => (i + 1) % rowRepos.length)
    }, 10000)
    return () => clearInterval(timer)
  }, [heroPaused, rowRepos.length])

  useEffect(() => {
    window.api.agents.getAll()
      .then(({ agents }) => setRankedAgents(rankAgents(agents)))
      .catch(() => setRankedAgents([]))
  }, [])

  // Always-current snapshot data — updated after every render so the unmount
  // cleanup can save accurate state regardless of how we leave the page.
  const liveSnapshotRef = useRef<import('../lib/discoverStateStore').DiscoverSnapshot | null>(null)
  useEffect(() => {
    liveSnapshotRef.current = {
      query: discoverQuery, repos, viewMode, selectedLanguages, appliedFilters,
      selectedSubtypes, activePanel, showLanding: false, mode,
      detectedTags, activeTags, relatedTags,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
      page, hasMore, searchPath, topicMode,
    }
    renderLimitRef.current = renderLimit
    allVisibleLengthRef.current = allVisible.length
    loadingMoreRef.current = loadingMore
    loadingRef.current = loading
  })

  useEffect(() => {
    return () => {
      if (liveSnapshotRef.current) {
        saveDiscoverSnapshot({
          ...liveSnapshotRef.current,
          scrollTop: scrollRef.current?.scrollTop ?? 0,
        })
      }
    }
  }, [])

  // On back-navigation, restore viewMode from snapshot into URL param
  useEffect(() => {
    if (restoredSnapshot.current?.viewMode) {
      // Legacy snapshots may carry the dropped 'all' or 'last-visited' view
      // modes — normalise to the new 'home' default before mirroring into URL.
      const raw = restoredSnapshot.current.viewMode as ViewModeKey | 'all' | 'last-visited'
      const snapshotView: ViewModeKey =
          raw === 'recommended' ? 'recommended'
        : raw === 'agents'      ? 'agents'
        : 'home'
      const urlView = searchParams.get('view') ?? 'home'
      if (snapshotView !== urlView) {
        setSearchParams(prev => {
          const next = new URLSearchParams(prev)
          if (snapshotView === 'home') next.delete('view')
          else next.set('view', snapshotView)
          return next
        }, { replace: true })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setViewMode = (mode: ViewModeKey) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (mode === 'home') next.delete('view')
      else next.set('view', mode)
      return next
    }, { replace: true })
  }

  useEffect(() => {
    window.api.search.getTopics().then(setAllTopics).catch(() => {})
  }, [])

  useEffect(() => {
    setContextQuery(restoredSnapshot.current !== null ? restoredSnapshot.current.query : contextQuery)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (contextQuery !== discoverQuery) setDiscoverQuery(contextQuery)
  }, [contextQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autocomplete suggestions
  useEffect(() => {
    const q = discoverQuery.trim().toLowerCase()
    const words = q.split(/\s+/)
    const lastWord = words[words.length - 1]

    if (!q) {
      setSuggestions([])
      setShowSuggestions(false)
      setSuggestionIndex(-1)
      return
    }

    const subtypeMatches: SubtypeSuggestion[] = []
    for (const bucket of REPO_BUCKETS) {
      for (const sub of bucket.subTypes) {
        if (new RegExp(`\\b${lastWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(sub.label)) {
          subtypeMatches.push({
            kind: 'subtype',
            label: sub.label,
            subTypeId: sub.id,
            bucketLabel: bucket.label,
            bucketColor: bucket.color,
          })
        }
      }
    }

    const topicMatches: TopicSuggestion[] = []
    if (allTopics.length > 0) {
      const prefix   = allTopics.filter(t => t.startsWith(lastWord) && t !== lastWord)
      const re = new RegExp(`\\b${lastWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      const midMatch = allTopics.filter(t => !t.startsWith(lastWord) && re.test(t))
      ;[...prefix, ...midMatch].forEach(t => topicMatches.push({ kind: 'topic', label: t }))
    }

    const merged: Suggestion[] = [...subtypeMatches, ...topicMatches].slice(0, 8)
    setSuggestions(merged)
    setShowSuggestions(merged.length > 0)
    setSuggestionIndex(-1)
  }, [discoverQuery, allTopics])

  useEffect(() => {
    const preloadTag = (location.state as { preloadTag?: string } | null)?.preloadTag
    if (preloadTag) addTag(preloadTag)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const lang = searchParams.get('lang')
    if (lang) {
      const match = LANGUAGES.find(l => l.name === lang || l.key === lang.toLowerCase())
      if (match) { setSelectedLanguages([match.key]); setSearchParams({}, { replace: true }) }
    }
  }, [searchParams, setSearchParams])

  const extractMissingColors = useCallback((rows: RepoRow[]) => {
    for (const repo of rows) {
      if (repo.banner_color || !repo.avatar_url || !repo.id) continue
      window.api.repo.extractColor(repo.avatar_url, repo.id)
        .then((color: { h: number; s: number; l: number }) => {
          setRepos(prev => prev.map(r =>
            r.id === repo.id ? { ...r, banner_color: JSON.stringify(color) } : r,
          ))
        })
        .catch(() => {/* non-critical */})
    }
  }, [])

  function buildTrendingQuery(vm: ViewModeKey, lang: string, filters: SearchFilters, subTypeTopic?: string): string {
    const baseQ = buildViewModeQuery(vm, lang, '')
    const filterParts: string[] = []
    if (subTypeTopic) filterParts.push(subTypeTopic)
    if (filters.activity === 'week')     filterParts.push('pushed:>' + (() => { const d = new Date(); d.setDate(d.getDate() - 7);  return d.toISOString().split('T')[0] })())
    if (filters.activity === 'month')    filterParts.push('pushed:>' + (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })())
    if (filters.activity === 'halfyear') filterParts.push('pushed:>' + (() => { const d = new Date(); d.setDate(d.getDate() - 180); return d.toISOString().split('T')[0] })())
    if (filters.stars)    filterParts.push(`stars:>${filters.stars}`)
    if (filters.license)  filterParts.push(`license:${filters.license}`)
    return [baseQ, ...filterParts].filter(Boolean).join(' ')
  }

  const loadTrending = useCallback(async (filters?: SearchFilters) => {
    const popularDefault = isPopularDefaultState(viewMode, selectedLanguages, selectedSubtypes, filters ?? {})
    const hasCachedPopular = popularDefault && _popularModuleCache != null

    if (hasCachedPopular) {
      // SWR: keep cached cards visible while the background refetch runs.
      // Switching back to default popular from a filtered view also lands here,
      // so we explicitly setRepos to the cached set rather than relying on
      // whatever was previously rendered.
      const cachedRepos = _popularModuleCache!.repos
      setRepos(cachedRepos)
      ensureClassified(cachedRepos)
      extractMissingColors(cachedRepos)
      const cachedIds = cachedRepos.map(r => r.id).filter(Boolean)
      if (cachedIds.length) window.api.verification.prioritise(cachedIds).catch(() => {})
    } else {
      setLoading(true)
      setRepos([])
    }
    setError(null)
    setRelatedTags([])
    setSearchPath('trending')
    setPage(1)
    setHasMore(true)
    setLoadingMore(false)
    const gen = ++fetchGeneration.current
    try {
      let data: RepoRow[]
      if (viewMode === 'agents') {
        // Agents come from window.api.agents.getAll(); the rankedAgents state
        // is hydrated separately so no GitHub fetch is needed here.
        data = []
        setHasMore(false)
      } else if (viewMode === 'recommended' && selectedSubtypes.length === 0) {
        if (recommendedCache.current) {
          data = recommendedCache.current
        } else if (_recommendedModuleCache && Date.now() - _recommendedModuleCache.fetchedAt < RECOMMENDED_TTL_MS) {
          data = _recommendedModuleCache.items.map(i => i.repo)
          recommendedCache.current = data
          recommendedItemsCache.current = _recommendedModuleCache.items
        } else {
          const response = await window.api.github.getRecommended()
          data = response.items.map(item => item.repo)
          recommendedCache.current = data
          recommendedItemsCache.current = response.items
          _recommendedModuleCache = { items: response.items, fetchedAt: Date.now() }
          saveCachedRecommended(response.items)
        }
      } else {
        const subKw = selectedSubtypes.length === 1
          ? getSubTypeKeyword(selectedSubtypes[0])
          : undefined
        const vm = viewMode === 'recommended' ? 'home' : viewMode
        const langKey = selectedLanguages.length === 1 ? selectedLanguages[0] : ''
        const q = buildTrendingQuery(vm, langKey, filters ?? {}, subKw)
        const { sort: s, order: o } = getViewModeSort(vm)
        data = await window.api.github.searchRepos(q, s, o)
      }
      if (gen !== fetchGeneration.current) return
      setRepos(data)
      ensureClassified(data)
      const ids = data.map(r => r.id).filter(Boolean)
      if (ids.length) window.api.verification.prioritise(ids).catch(() => {})
      extractMissingColors(data)

      // Persist fresh popular-default results so the next cold launch renders instantly.
      if (popularDefault) {
        _popularModuleCache = { repos: data, fetchedAt: Date.now() }
        saveCachedPopular(data)
      }
    } catch (e: unknown) {
      if (gen !== fetchGeneration.current) return
      // If the user already sees cached cards, suppress the error overlay and
      // keep the stale cards visible — better UX than blanking the page. Log so
      // repeated background-fetch failures aren't completely invisible during
      // debugging; the user-visible signal is intentionally absent for now.
      if (hasCachedPopular) {
        console.warn('[discover] popular refetch failed; keeping cached cards', e)
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    } finally {
      if (gen === fetchGeneration.current) setLoading(false)
    }
  }, [viewMode, selectedLanguages, selectedSubtypes, extractMissingColors])

  const hasMounted = useRef(false)
  useEffect(() => {
    return () => { hasMounted.current = false }
  }, [])

  const selectedLanguagesKey = selectedLanguages.join(',')
  const selectedSubtypesKey = selectedSubtypes.join(',')

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      // Only skip the initial fetch if the snapshot actually has repos to render.
      // A snapshot with empty `repos` means the user navigated away mid-load —
      // skipping here leaves the grid permanently empty.
      if (restoredFromSnapshot.current && (restoredSnapshot.current?.repos?.length ?? 0) > 0) return
    }
    recommendedCache.current = null
    recommendedItemsCache.current = null
    setTopicMode(false)
    if (discoverQuery.trim() || activeTags.length) {
      setDiscoverQuery('')
      setContextQuery('')
      setDetectedTags([])
      setActiveTags([])
      setRelatedTags([])
    }
    loadTrending(appliedFilters)
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevSelectedLanguagesKey = useRef(selectedLanguagesKey)
  useEffect(() => {
    if (prevSelectedLanguagesKey.current === selectedLanguagesKey) return
    prevSelectedLanguagesKey.current = selectedLanguagesKey
    recommendedCache.current = null
    recommendedItemsCache.current = null
    const timer = setTimeout(() => {
      if (!discoverQuery.trim()) loadTrending(appliedFilters)
    }, 400)
    return () => clearTimeout(timer)
  }, [selectedLanguagesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevSelectedSubtypesKey = useRef(selectedSubtypesKey)
  useEffect(() => {
    if (prevSelectedSubtypesKey.current === selectedSubtypesKey) return
    prevSelectedSubtypesKey.current = selectedSubtypesKey
    const timer = setTimeout(() => {
      if (!discoverQuery.trim()) loadTrending(appliedFilters)
    }, 400)
    return () => clearTimeout(timer)
  }, [selectedSubtypesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let timer: ReturnType<typeof setTimeout>
    const onScroll = () => {
      setDitherScrollHint(true)
      setNavCompact(scroller.scrollTop > 150)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const ids = repos.map(r => r.id).filter(Boolean)
        if (ids.length) window.api.verification.prioritise(ids).catch(() => {})
      }, 200)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => { clearTimeout(timer); scroller.removeEventListener('scroll', onScroll) }
  }, [repos])

  useEffect(() => {
    const el = discoverInputRef?.current
    if (!el) return
    const handleKeyDown = (e: KeyboardEvent) => keyDownHandlerRef.current(e)
    const handleBlur    = (e: FocusEvent)    => blurHandlerRef.current(e)
    const handleFocus   = (e: FocusEvent)    => focusHandlerRef.current(e)
    el.addEventListener('keydown', handleKeyDown)
    el.addEventListener('blur',    handleBlur)
    el.addEventListener('focus',   handleFocus)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
      el.removeEventListener('blur',    handleBlur)
      el.removeEventListener('focus',   handleFocus)
    }
  }, [discoverInputRef?.current, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showSuggestions) return
    const handleMouseDown = (e: MouseEvent) => {
      if (
        suggestionsRef.current?.contains(e.target as Node) ||
        discoverInputRef?.current?.contains(e.target as Node)
      ) return
      setShowSuggestions(false)
      setSuggestionIndex(-1)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowSuggestions(false); setSuggestionIndex(-1) }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSuggestions]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasSentinel = !loading && !error && repos.length > 0
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMoreRef.current()
      },
      { root, rootMargin: '0px 0px 400px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasSentinel, layoutPrefs.mode])

  const runTagSearch = useCallback(async (tags: string[], filters?: SearchFilters) => {
    setLoading(true)
    setSearchPath('tagged')
    setPage(1)
    setHasMore(true)
    fetchGeneration.current += 1
    const langFilter = selectedLanguages.length === 1 ? selectedLanguages[0] : undefined
    try {
      const res = await window.api.search.tagged(tags, discoverQuery, langFilter, filters ?? appliedFilters)
      setRepos(res)
      ensureClassified(res)
      extractMissingColors(res)
      const ids = res.map(r => r.id).filter(Boolean)
      if (ids.length) window.api.verification.prioritise(ids).catch(() => {})
      const related = await window.api.search.getRelatedTags(res, tags)
      setRelatedTags(related)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [selectedLanguages, discoverQuery, appliedFilters, extractMissingColors])

  const handleSearch = async (overrideFilters?: SearchFilters, overrideQuery?: string) => {
    setTopicMode(false)
    const filters = overrideFilters ?? appliedFilters
    const q = overrideQuery ?? discoverQuery
    const langFilter = selectedLanguages.length === 1 ? selectedLanguages[0] : undefined
    if (!q.trim()) { loadTrending(filters); return }
    searchHistory.add(q)

    const searchMode = detectSearchMode(q)
    setMode(searchMode)
    setLoading(true)
    setError(null)
    setPage(1)
    setHasMore(true)
    fetchGeneration.current += 1

    if (searchMode === 'raw') {
      setSearchPath('raw')
      try {
        const res = await window.api.search.raw(q, langFilter, filters)
        setRepos(res)
        ensureClassified(res)
        const ids = res.map(r => r.id).filter(Boolean)
        if (ids.length) window.api.verification.prioritise(ids).catch(() => {})
        extractMissingColors(res)
        setDetectedTags([])
        setActiveTags([])
        const related = await window.api.search.getRelatedTags(res, [])
        setRelatedTags(related)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    } else {
      setAnalysing(true)
      try {
        const tags = await window.api.search.extractTags(q)
        const usedTags = tags.length > 0 ? tags : q.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)
        setDetectedTags(usedTags)
        setActiveTags(usedTags)
        setAnalysing(false)
        await runTagSearch(usedTags, filters)
      } catch (e: unknown) {
        setAnalysing(false)
        setSearchPath('raw')
        try {
          const res = await window.api.search.raw(q, langFilter, filters)
          setRepos(res)
          ensureClassified(res)
          const ids = res.map(r => r.id).filter(Boolean)
          if (ids.length) window.api.verification.prioritise(ids).catch(() => {})
        } catch {
          setError('Search failed')
        } finally {
          setLoading(false)
        }
      }
    }
  }

  // ── Derived: visible repos ───────────────────────────────────────

  const prevReposRef = useRef(repos)
  useEffect(() => {
    const prev = prevReposRef.current
    prevReposRef.current = repos
    if (prev === repos) return
    const replaced = repos.length === 0
      || prev.length === 0
      || repos.length < prev.length
      || repos[0] !== prev[0]
    if (replaced) setRenderLimit(RENDER_CHUNK)
  }, [repos])

  const allVisible = useMemo(() => {
    return repos.filter(r =>
      (selectedSubtypes.length === 0 || (r.type_sub != null && selectedSubtypes.includes(r.type_sub))) &&
      (activeVerification.size === 0 || activeVerification.has(verification.getTier(r.id) as 'verified' | 'likely')) &&
      (selectedLanguages.length === 0 || (r.language != null && selectedLanguages.some(l => l.toLowerCase() === r.language!.toLowerCase())))
    )
  }, [repos, selectedSubtypes, activeVerification, verification, selectedLanguages])

  const visibleRepos = useMemo(
    () => allVisible.slice(0, renderLimit),
    [allVisible, renderLimit]
  )

  const anchorsByRepoId = useMemo(() => {
    if (viewMode !== 'recommended') return undefined
    const items = recommendedItemsCache.current
    if (!items) return undefined
    return new Map(items.map(item => [item.repo.id, item.anchors]))
    // repos change is the proxy signal that recommendedItemsCache.current was just written
  }, [viewMode, repos])

  const hasBuffered = renderLimit < allVisible.length

  // ── Keyboard navigation ────────────────────────────────────────
  const [kbFocusIndex, setKbFocusIndex] = useState(-1)
  const kbNav = useKeyboardNav({
    itemCount: visibleRepos.length,
    columns: layoutPrefs.mode === 'grid' ? effectiveCols : 1,
    onFocusChange: setKbFocusIndex,
    onSelect: (idx) => {
      const repo = visibleRepos[idx]
      if (repo) navigateToRepo(`/repo/${repo.owner}/${repo.name}`)
    },
    enabled: !showSuggestions,
  })
  // Reset focus when results change
  useEffect(() => { setKbFocusIndex(-1) }, [visibleRepos.length])

  // ── Pagination ─────────────────────────────────────────────────

  const PER_PAGE = 100

  const loadMore = useCallback(async () => {
    const snap = liveSnapshotRef.current
    if (!snap) return
    if (renderLimitRef.current < allVisibleLengthRef.current) {
      setRenderLimit(prev => prev + RENDER_CHUNK)
      return
    }
    if (loadingMoreRef.current || loadingRef.current || !snap.hasMore) return
    setLoadingMore(true)
    const gen = fetchGeneration.current
    const { page, searchPath, viewMode, selectedLanguages, appliedFilters, activeTags, repos, selectedSubtypes = [] } = snap
    const discoverQuery = snap.query
    const nextPage = page + 1

    try {
      let newResults: RepoRow[]
      if (searchPath === 'trending') {
        if (viewMode === 'recommended' && selectedSubtypes.length === 0) {
          // Paginate the recommendation engine: fetch the next GitHub search page
          // for each query plan, exclude already-shown ids server-side, re-rank.
          const excludeIds = repos.map(r => String(r.id))
          const response = await window.api.github.getRecommended(nextPage, excludeIds)
          newResults = response.items.map(item => item.repo)
          if (recommendedItemsCache.current) {
            recommendedItemsCache.current = [...recommendedItemsCache.current, ...response.items]
          }
        } else {
          const subKw = selectedSubtypes.length === 1
            ? getSubTypeKeyword(selectedSubtypes[0])
            : undefined
          const vm = viewMode === 'recommended' ? 'home' : viewMode
          const langKey = selectedLanguages.length === 1 ? selectedLanguages[0] : ''
          const q = buildTrendingQuery(vm, langKey, appliedFilters, subKw)
          const { sort: s, order: o } = getViewModeSort(vm)
          newResults = await window.api.github.searchRepos(q, s, o, nextPage)
        }
      } else if (searchPath === 'raw') {
        const langFilter = selectedLanguages.length === 1 ? selectedLanguages[0] : undefined
        newResults = await window.api.search.raw(discoverQuery, langFilter, appliedFilters, nextPage)
      } else {
        const langFilter = selectedLanguages.length === 1 ? selectedLanguages[0] : undefined
        newResults = await window.api.search.tagged(activeTags, discoverQuery, langFilter, appliedFilters, nextPage)
      }

      if (gen !== fetchGeneration.current) return

      const existingIds = new Set(repos.map(r => r.id))
      const unique = newResults.filter(r => !existingIds.has(r.id))

      if (unique.length > 0) {
        setRepos(prev => [...prev, ...unique])
        setRenderLimit(prev => prev + RENDER_CHUNK)
        ensureClassified(unique)
        extractMissingColors(unique)
        const newIds = unique.map(r => r.id).filter(Boolean)
        if (newIds.length) window.api.verification.prioritise(newIds).catch(() => {})
      }

      setPage(nextPage)
      if (unique.length === 0 && newResults.length > 0) {
        // All results were duplicates — no point fetching further pages
        setHasMore(false)
      } else if (searchPath === 'tagged') {
        setHasMore(newResults.length > 0)
      } else if (viewMode === 'recommended' && selectedSubtypes.length === 0) {
        // Recommended pages can be small after anchor + niche filtering; stop only
        // when the engine returns nothing new.
        setHasMore(newResults.length > 0)
      } else {
        setHasMore(newResults.length >= PER_PAGE / 2)
      }
    } catch {
      setHasMore(false)
    } finally {
      if (gen === fetchGeneration.current) {
        setLoadingMore(false)
      }
    }
  }, [extractMissingColors])

  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  // Stable callback — reads live snapshot via ref so it doesn't need to list every state var as a dep
  const navigateToRepo = useCallback((path: string) => {
    const snap = liveSnapshotRef.current
    if (snap) saveDiscoverSnapshot({ ...snap, scrollTop: scrollRef.current?.scrollTop ?? 0 })
    const match = path.match(/^\/repo\/([^/]+)\/([^/]+)/)
    const repo = snap?.repos && match ? snap.repos.find(r => r.owner === match[1] && r.name === match[2]) : null
    if (repo?.id) {
      window.api.engagement.logClick(repo.id, snap?.viewMode === 'recommended' ? 'recommended' : 'discover')
        .catch(() => { /* non-critical */ })
    }
    navigate(path, { state: { fromDiscoverView: snap?.viewMode, fromDiscoverPath: location.pathname + location.search, repoAvatarUrl: repo?.avatar_url ?? null, background: location } })
  }, [navigate, location.pathname, location.search])

  const handleAiNavigate = useCallback((owner: string, name: string) => {
    navigateToRepo(`/repo/${owner}/${name}`)
  }, [navigateToRepo])

  // Stable callback — reads activeTags via liveSnapshotRef to avoid capturing it in deps
  const addTag = useCallback((tag: string) => {
    const currentTags = liveSnapshotRef.current?.activeTags ?? []
    if (currentTags.includes(tag)) return
    const next = [...currentTags, tag]
    setActiveTags(next)
    setDetectedTags(prev => prev.includes(tag) ? prev : [...prev, tag])
    runTagSearch(next)
  }, [runTagSearch])

  // ── Filter logic ─────────────────────────────────────────────────

  function handleFilterChange(newFilters: SearchFilters) {
    setAppliedFilters(newFilters)
    handleSearch(newFilters)
  }

  // ── Keyboard / focus handlers ───────────────────────────────────

  keyDownHandlerRef.current = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const max = (discoverQuery.trim() === '' && searchHistory.entries.length > 0)
        ? searchHistory.entries.length - 1
        : suggestions.length - 1
      setSuggestionIndex(i => Math.min(i + 1, max))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setSuggestionIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false); setSuggestionIndex(-1)
    } else if (e.key === 'Enter') {
      if (showHistory && suggestionIndex >= 0 && searchHistory.entries[suggestionIndex]) {
        const entry = searchHistory.entries[suggestionIndex]
        setDiscoverQuery(entry); setContextQuery(entry)
        setShowSuggestions(false); setSuggestionIndex(-1)
        handleSearch(undefined, entry)
      } else if (suggestionIndex >= 0 && suggestions[suggestionIndex]?.kind === 'subtype') {
        const s = suggestions[suggestionIndex] as SubtypeSuggestion
        setSelectedSubtypes([s.subTypeId])
        setDiscoverQuery(''); setContextQuery('')
        setShowSuggestions(false); setSuggestionIndex(-1)
      } else if (suggestionIndex >= 0 && suggestions[suggestionIndex]?.kind === 'topic') {
        handleSelectTopic((suggestions[suggestionIndex] as TopicSuggestion).label)
      } else {
        setShowSuggestions(false)
        handleSearch()
      }
    }
  }

  blurHandlerRef.current = () => {
    setTimeout(() => { setShowSuggestions(false); setSearchFocused(false) }, 150)
  }

  focusHandlerRef.current = () => {
    setSearchFocused(true)
    if (discoverQuery.trim() === '' && searchHistory.entries.length > 0) {
      setShowSuggestions(true); setSuggestionIndex(-1)
    } else if (suggestions.length > 0) {
      setShowSuggestions(true)
    }
  }

  const suggestionAnchor = (showSuggestions && (showHistory || suggestions.length > 0))
    ? (discoverInputRef?.current?.getBoundingClientRect() ?? null)
    : null

  const suggestionsAbove = false

  // ── Suggestion callbacks ────────────────────────────────────────

  const handleSelectHistory = (entry: string) => {
    setDiscoverQuery(entry); setContextQuery(entry)
    setShowSuggestions(false)
    setSuggestionIndex(-1)
    handleSearch(undefined, entry)
  }

  const handleSelectSubtype = useCallback((subTypeId: string) => {
    setSelectedSubtypes([subTypeId])
    setDiscoverQuery('')
    setContextQuery('')
    setShowSuggestions(false)
    setSuggestionIndex(-1)
  }, [setContextQuery])

  const handleStar = useCallback((repoId: string, starred: boolean) => {
    if (starred && viewMode === 'recommended') {
      setRepos(prev => prev.filter(r => r.id !== repoId))
    }
  }, [viewMode])

  const handleLanguageClick = useCallback((lang: string) => {
    setSelectedLanguages(prev => prev.includes(lang) ? prev : [...prev, lang])
  }, [])

  const handleBackFromTopicMode = useCallback(() => {
    setTopicMode(false)
    setActiveTags([])
    setDetectedTags([])
    setRelatedTags([])
    loadTrending(appliedFilters)
  }, [loadTrending, appliedFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackFromSubtypeMode = useCallback(() => {
    setSelectedSubtypes([])
  }, [])

  const handleBackFromSearch = useCallback(() => {
    setDiscoverQuery('')
    setContextQuery('')
    setDetectedTags([])
    setActiveTags([])
    setRelatedTags([])
    loadTrending(appliedFilters)
  }, [setContextQuery, loadTrending, appliedFilters])

  const inSearchResults =
    searchPath !== 'trending' &&
    !topicMode &&
    selectedSubtypes.length === 0 &&
    (!!discoverQuery.trim() || activeTags.length > 0)

  const handleSelectTopic = (label: string) => {
    setShowSuggestions(false)
    setSuggestionIndex(-1)
    setDiscoverQuery('')
    setContextQuery('')
    setTopicMode(true)
    const currentTags = liveSnapshotRef.current?.activeTags ?? []
    if (!currentTags.includes(label)) {
      const next = [...currentTags, label]
      setActiveTags(next)
      setDetectedTags(next)
      runTagSearch(next)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="discover">
      {/* Suggestions portal */}
      <DiscoverSuggestions
        anchor={suggestionAnchor}
        above={suggestionsAbove}
        suggestionsRef={suggestionsRef}
        showHistory={showHistory}
        searchHistory={searchHistory}
        suggestions={suggestions}
        suggestionIndex={suggestionIndex}
        onSuggestionIndex={setSuggestionIndex}
        onSelectHistory={handleSelectHistory}
        onSelectSubtype={handleSelectSubtype}
        onSelectTopic={handleSelectTopic}
      />

      <AiChatOverlay
        visible={aiChatVisible}
        onClose={() => setAiChatVisible(false)}
        onNavigate={handleAiNavigate}
        initialQuery={aiInitialQuery}
        onInitialQueryConsumed={() => setAiInitialQuery(undefined)}
      />

      <div className="discover-layout">
        <DiscoverTopNav
          selectedSubtypes={selectedSubtypes}
          onSelectedSubtypesChange={setSelectedSubtypes}
          filters={appliedFilters}
          selectedLanguages={selectedLanguages}
          activeVerification={activeVerification}
          onFilterChange={handleFilterChange}
          onSelectedLanguagesChange={setSelectedLanguages}
          onVerificationToggle={handleVerificationToggle}
          activePanel={activePanel}
          onActivePanelChange={setActivePanel}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          query={discoverQuery}
          onQueryChange={(q) => { setDiscoverQuery(q); setContextQuery(q) }}
          onSearch={handleSearch}
          inputRef={topNavInputRef}
          layoutPrefs={layoutPrefs}
          onLayoutChange={handleLayoutChange}
          compact={navCompact || viewMode !== 'home' || topicMode || selectedSubtypes.length > 0 || inSearchResults}
        />
        <div className="discover-main">
          <div ref={scrollRef} className={`discover-content ${aiChatVisible ? 'discover-content-dimmed' : ''}`} onKeyDown={kbNav.containerProps.onKeyDown} tabIndex={-1}>
                {viewMode === 'home' && !topicMode && selectedSubtypes.length === 0 && !inSearchResults && (
                  <>
                    {rowRepos.length > 0
                      ? <DiscoverHero repo={rowRepos[heroIndex] ?? null} onNavigate={navigateToRepo} />
                      : <div className="discover-hero discover-hero--skeleton" />}

                    {rowRepos.length > 0 && (
                      <DiscoverRow<RepoRow>
                        title="Recommended for You"
                        items={rowRepos}
                        activeIndex={heroIndex}
                        columns={effectiveCols}
                        getItemKey={r => r.id}
                        renderCard={({ item, posIndex, columns, visible }) => (
                          <DiscoverRowRepoCard
                            repo={item}
                            posIndex={posIndex}
                            columns={columns}
                            visible={visible}
                            onNavigate={navigateToRepo}
                            onLanguageClick={handleLanguageClick}
                          />
                        )}
                        onMore={() => setViewMode('recommended')}
                        onPause={setHeroPaused}
                        onAdvance={(delta) => {
                          const visible = Math.min(effectiveCols, rowRepos.length)
                          const max = Math.max(0, rowRepos.length - visible)
                          setHeroIndex((i) => Math.max(0, Math.min(max, i + delta)))
                        }}
                      />
                    )}

                    {rankedAgents.length > 0 && (
                      <DiscoverRow<AgentRow>
                        title="Agents"
                        items={rankedAgents}
                        activeIndex={0}
                        columns={effectiveCols}
                        getItemKey={a => a.id}
                        renderCard={({ item, posIndex, columns, visible }) => (
                          <DiscoverRowAgentCard
                            agent={item}
                            posIndex={posIndex}
                            columns={columns}
                            visible={visible}
                            onNavigate={navigateToRepo}
                          />
                        )}
                        onMore={() => setViewMode('agents')}
                        onAdvance={() => {/* static list; horizontal scroll deferred */}}
                      />
                    )}

                    {repos.length > 0 && (
                      <DiscoverRow<RepoRow>
                        title="Most Popular"
                        items={repos.slice(0, 30)}
                        activeIndex={0}
                        columns={effectiveCols}
                        getItemKey={r => r.id}
                        renderCard={({ item, posIndex, columns, visible }) => (
                          <DiscoverRowRepoCard
                            repo={item}
                            posIndex={posIndex}
                            columns={columns}
                            visible={visible}
                            onNavigate={navigateToRepo}
                            onLanguageClick={handleLanguageClick}
                          />
                        )}
                        onAdvance={() => {/* static list; horizontal scroll deferred */}}
                      />
                    )}
                  </>
                )}
                <div className="discover-content-inner">
                  {viewMode !== 'home' && (
                    <FilterChipRow
                      selectedLanguages={selectedLanguages}
                      selectedSubtypes={selectedSubtypes}
                      activeTags={activeTags}
                      filters={appliedFilters}
                      activeVerification={activeVerification}
                      onRemoveLanguage={(lang) => setSelectedLanguages(prev => prev.filter(l => l !== lang))}
                      onRemoveSubtype={(id) => setSelectedSubtypes(prev => prev.filter(s => s !== id))}
                      onRemoveTag={(tag) => {
                        const next = activeTags.filter(t => t !== tag)
                        setActiveTags(next)
                        if (next.length === 0) {
                          setTopicMode(false)
                          loadTrending(appliedFilters)
                        } else {
                          runTagSearch(next)
                        }
                      }}
                      onClearAdvanced={(key) => setAppliedFilters(prev => ({ ...prev, [key]: undefined }))}
                      onVerificationToggle={handleVerificationToggle}
                      onSelectedLanguagesChange={setSelectedLanguages}
                      onSelectedSubtypesChange={setSelectedSubtypes}
                      onFilterChange={setAppliedFilters}
                    />
                  )}

                  {error && <div className="discover-status">Failed to load — {error}</div>}

                  <DiscoverGrid
                    loading={loading}
                    loadingMore={loadingMore}
                    error={error}
                    visibleRepos={visibleRepos}
                    agents={viewMode === 'agents' ? rankedAgents : undefined}
                    discoverQuery={discoverQuery}
                    layoutPrefs={effectiveLayoutPrefs}
                    sentinelRef={sentinelRef}
                    gridRef={gridRef}
                    verification={verification}
                    onNavigate={navigateToRepo}
                    onTagClick={addTag}
                    onOwnerClick={openProfile}
                    focusIndex={kbFocusIndex}
                    viewMode={viewMode}
                    onStar={handleStar}
                    onLanguageClick={handleLanguageClick}
                    onSubtypeClick={handleSelectSubtype}
                    anchorsByRepoId={anchorsByRepoId}
                  />
                </div>
          </div>
          <div className="discover-drag-strip" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
