import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LibrarySavedRepo } from '../types/repo'
import { formatStars } from '../types/repo'
import { useSavedRepos } from '../contexts/SavedRepos'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import { useSearch } from '../contexts/Search'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import VerifiedBadge from '../components/VerifiedBadge'
import LanguageIcon from '../components/LanguageIcon'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { HOST_ID_GITHUB } from '../lib/hostIds'

type SortKey = 'recent' | 'stars' | 'az'
type FilterKey = 'all' | 'not-installed' | 'installed'
type InstallState = 'UNINSTALLED' | 'GENERATING' | 'INSTALLED'

export default function Starred() {
  const { saveRepo } = useSavedRepos()
  const { openProfile } = useProfileOverlay()

  // Data
  const [rows, setRows] = useState<LibrarySavedRepo[]>([])
  const [loading, setLoading] = useState(true)

  // Account bar
  const auth = useGitHubAuth()
  const userLogin = auth.user?.login ?? null
  const [syncedAgo, setSyncedAgo] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Controls
  const { query: search } = useSearch()
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<FilterKey>('all')

  // Per-row install state: key = "owner/name"
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [installErrors, setInstallErrors] = useState<Record<string, string | null>>({})

  // Per-owner verified badge: key = "owner"
  const [verifiedOwners, setVerifiedOwners] = useState<Record<string, boolean>>({})

  const loadRows = useCallback(async () => {
    const data = await window.api.starred.getAll()
    setRows(data)
    // Initialise install states from DB (don't overwrite in-progress states)
    setInstallStates((prev) => {
      const next = { ...prev }
      for (const r of data) {
        const key = `${r.owner}/${r.name}`
        if (!(key in next)) {
          next[key] = r.installed === 1 ? 'INSTALLED' : 'UNINSTALLED'
        }
      }
      return next
    })
    setLoading(false)
    // Non-blocking: check verified status for each unique owner
    const uniqueOwners = [...new Set(data.map(r => r.owner))]
    for (const owner of uniqueOwners) {
      window.api.org.getVerified(owner)
        .then(v => { if (v) setVerifiedOwners(prev => ({ ...prev, [owner]: true })) })
        .catch(() => {})
    }
  }, [])

  const loadSyncedAgo = useCallback(async () => {
    const val = await window.api.settings.get('last_starred_sync')
    if (!val) { setSyncedAgo(null); return }
    const mins = Math.floor((Date.now() - Number(val)) / 60_000)
    setSyncedAgo(mins < 1 ? 'just now' : `${mins} min ago`)
  }, [])

  useEffect(() => {
    loadSyncedAgo()
    loadRows()
  }, [loadRows, loadSyncedAgo])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await window.api.repo.getMyStarred(HOST_ID_GITHUB, true)
      await loadRows()
      await loadSyncedAgo()
    } finally {
      setSyncing(false)
    }
  }

  // ── Derived data ────────────────────────────────────────────────

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'stars') return (b.stars ?? 0) - (a.stars ?? 0)
    if (sort === 'az') return a.name.localeCompare(b.name)
    return 0 // 'recent' — already sorted DESC from DB
  })

  const totalCount = rows.length
  const installedCount = rows.filter((r) => {
    const key = `${r.owner}/${r.name}`
    const state = installStates[key]
    return state === 'INSTALLED' || (state === undefined && r.installed === 1)
  }).length
  const notInstalledCount = totalCount - installedCount

  const visible = sorted.filter((r) => {
    const key = `${r.owner}/${r.name}`
    const state = installStates[key]
    const isInstalled = state === 'INSTALLED' || (state === undefined && r.installed === 1)
    if (filter === 'installed' && !isInstalled) return false
    if (filter === 'not-installed' && isInstalled) return false
    if (search) {
      const q = search.toLowerCase()
      const matches =
        r.name.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false)
      if (!matches) return false
    }
    return true
  })

  // Time buckets
  const now = useMemo(() => Date.now(), [visible])
  const buckets: { label: string; rows: LibrarySavedRepo[] }[] = []
  const week: LibrarySavedRepo[] = []
  const month: LibrarySavedRepo[] = []
  const older: LibrarySavedRepo[] = []
  let hasDates = false

  for (const r of visible) {
    if (!r.starredAt) { older.push(r); continue }
    hasDates = true
    const age = now - new Date(r.starredAt).getTime()
    if (age < 7 * 86_400_000) week.push(r)
    else if (age < 30 * 86_400_000) month.push(r)
    else older.push(r)
  }

  if (hasDates) {
    if (week.length)  buckets.push({ label: 'This week',  rows: week })
    if (month.length) buckets.push({ label: 'This month', rows: month })
    if (older.length) buckets.push({ label: 'Older',      rows: older })
  } else {
    buckets.push({ label: 'All starred', rows: visible })
  }

  // ── Keyboard navigation ─────────────────────────────────────────
  const navigate = useNavigate()
  const [kbFocusIndex, setKbFocusIndex] = useState(-1)
  const kbNav = useKeyboardNav({
    itemCount: visible.length,
    onFocusChange: setKbFocusIndex,
    onSelect: (idx) => {
      const repo = visible[idx]
      if (repo) navigate(`/repo/${repo.owner}/${repo.name}`)
    },
  })
  useEffect(() => { setKbFocusIndex(-1) }, [visible.length])

  // ── Install handler ─────────────────────────────────────────────
  const handleInstall = async (owner: string, name: string) => {
    const key = `${owner}/${name}`
    setInstallErrors((p) => ({ ...p, [key]: null }))
    setInstallStates((p) => ({ ...p, [key]: 'GENERATING' }))
    try {
      await saveRepo(owner, name)
      await window.api.skill.generate(owner, name, { flavour: 'library' })
      setInstallStates((p) => ({ ...p, [key]: 'INSTALLED' }))
    } catch (err) {
      setInstallStates((p) => ({ ...p, [key]: 'UNINSTALLED' }))
      const msg = err instanceof Error ? err.message : ''
      setInstallErrors((p) => ({ ...p, [key]: msg.includes('Claude Code not found') || msg.includes('No API key') ? 'no-key' : 'failed' }))
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  const initial = userLogin?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="starred-layout">
      {/* GitHub account bar */}
      <div className="github-account-bar">
        <div className="account-bar-avatar">{initial}</div>
        <span className="account-bar-username">{userLogin ?? '—'}</span>
        {userLogin && (
          <span className="account-bar-handle">github.com/{userLogin}</span>
        )}
        <div className="account-bar-sync">
          <div className="account-bar-sync-dot" />
          <span className="account-bar-sync-text">
            {syncedAgo ? `synced ${syncedAgo}` : 'not synced'}
          </span>
          <button
            className={`starred-sync-btn${syncing ? ' syncing' : ''}`}
            onClick={handleSync}
            disabled={syncing}
          >
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8.5 5A3.5 3.5 0 1 1 5 1.5" strokeLinecap="round" />
              <path d="M5 0v2.5L7 1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sync GitHub
          </button>
        </div>
      </div>

      {/* Topbar */}
      <div className="starred-topbar">
        {(['recent', 'stars', 'az'] as SortKey[]).map((s) => (
          <button
            key={s}
            className={`starred-sort-btn${sort === s ? ' active' : ''}`}
            onClick={() => setSort(s)}
          >
            {s === 'recent' ? 'Recent' : s === 'stars' ? 'Stars' : 'A–Z'}
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="starred-filter-chips">
        <button
          className={`starred-chip${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All {totalCount}
        </button>
        <button
          className={`starred-chip${filter === 'not-installed' ? ' active' : ''}`}
          onClick={() => setFilter('not-installed')}
        >
          Not installed {notInstalledCount}
        </button>
        <button
          className={`starred-chip${filter === 'installed' ? ' active' : ''}`}
          onClick={() => setFilter('installed')}
        >
          Installed {installedCount}
        </button>
      </div>

      {/* List */}
      <div className="starred-list" onKeyDown={kbNav.containerProps.onKeyDown} tabIndex={-1}>
        {loading && (
          <div className="starred-empty">Loading starred repos…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="starred-empty">
            No starred repos found. Try syncing GitHub.
          </div>
        )}
        {!loading && rows.length > 0 && visible.length === 0 && (
          <div className="starred-empty">No repos match your filter.</div>
        )}
        {!loading && buckets.map((bucket) => (
          <div key={bucket.label}>
            <div className="starred-section-header">
              <span className="starred-section-label">{bucket.label}</span>
              <div className="starred-section-line" />
              <span className="starred-section-count">{bucket.rows.length}</span>
            </div>
            {bucket.rows.map((r) => {
              const key = `${r.owner}/${r.name}`
              const isFocused = visible.indexOf(r) === kbFocusIndex
              const state = installStates[key] ?? (r.installed === 1 ? 'INSTALLED' : 'UNINSTALLED')
              const err = installErrors[key]
              return (
                <div key={key} className={`starred-row${isFocused ? ' kb-focused' : ''}`} ref={el => { if (isFocused && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }}>
                  <span className="starred-lang-icon">
                    <LanguageIcon lang={r.language} size={14} />
                  </span>
                  <div className="starred-info">
                    <div className="starred-name-row">
                      <button
                        className="owner-name-btn starred-owner"
                        onClick={(e) => { e.stopPropagation(); openProfile(r.owner) }}
                      >
                        {r.owner}
                      </button>
                      <span style={{ color: 'var(--t3)' }}>/</span>
                      <span className="starred-name">{r.name}</span>
                      {verifiedOwners[r.owner] && <VerifiedBadge size={10} />}
                      {r.type && (
                        <span className={`type-badge type-${r.type}`}>{r.type}</span>
                      )}
                    </div>
                    {r.description && (
                      <div className="starred-description" title={r.description}>
                        {r.description}
                      </div>
                    )}
                    {err === 'no-key' && (
                      <div style={{ fontSize: 9, color: 'var(--red-text)', marginTop: 2 }}>
                        Install Claude or add an API key in Settings
                      </div>
                    )}
                    {err === 'failed' && (
                      <div style={{ fontSize: 9, color: 'var(--red-text)', marginTop: 2 }}>
                        Generation failed. Try again.
                      </div>
                    )}
                  </div>
                  <div className="starred-right">
                    <div className="starred-star-count">
                      <svg viewBox="0 0 9 9" fill="currentColor">
                        <path d="M4.5 0l1.1 2.2 2.4.35-1.75 1.7.41 2.4L4.5 5.5l-2.16 1.15.41-2.4L1 2.55l2.4-.35z" />
                      </svg>
                      {formatStars(r.stars)}
                    </div>
                    <button
                      className={`starred-install-btn${state === 'GENERATING' ? ' generating' : state === 'INSTALLED' ? ' installed' : ''}`}
                      onClick={() => state === 'UNINSTALLED' && handleInstall(r.owner, r.name)}
                      disabled={state === 'GENERATING'}
                    >
                      {state === 'GENERATING' ? '⟳ Generating…' : state === 'INSTALLED' ? '✓ Installed' : '+ Install'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
