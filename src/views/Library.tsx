import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useMatch, useLocation } from 'react-router-dom'
import { type LibrarySavedRepo, type SavedRepo } from '../types/repo'
import type { CollectionRow } from '../types/repo'
import type { LocalProject } from '../types/library'
import { useToast } from '../contexts/Toast'
import { useRepoNav } from '../contexts/RepoNav'
import { useArchivedRepos } from '../hooks/useArchivedRepos'
import { useLocalProjects } from '../hooks/useLocalProjects'
import { getRecentVisits, recordRecentVisit } from '../lib/recentVisits'
import type { RecentEntry } from '../lib/recentVisits'
import LibraryDetailRoutes from '../components/LibraryDetailRoutes'
import LibrarySidebar from '../components/LibrarySidebar'
import ActivityFeed from '../components/ActivityFeed'
import AgentsLanding from './AgentsLanding'
import { primeRepoCacheFromRows } from './RepoDetail'
import { prewarmStaticDither } from '../hooks/useBayerDither'
import { cameraIdxForRepo } from '../utils/repoCameraSeed'

export default function Library() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { state: repoNav } = useRepoNav()
  const { archivedSet } = useArchivedRepos()
  const location = useLocation()
  const isMiniTab = repoNav.activeTab === 'files' || repoNav.activeTab === 'components'

  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const agentMatch = useMatch('/library/agent/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null || agentMatch !== null

  const [rows, setRows] = useState<LibrarySavedRepo[]>([])
  const [starredRows, setStarredRows] = useState<LibrarySavedRepo[]>([])
  const [unstarredRows, setUnstarredRows] = useState<LibrarySavedRepo[]>([])
  const localProjects = useLocalProjects()
  const [recentVisits, setRecentVisits] = useState<RecentEntry[]>(() => getRecentVisits())
  const [mode, setMode] = useState<'repos' | 'collections' | 'agents'>('repos')

  const refreshRecentVisits = useCallback(() => {
    setRecentVisits(getRecentVisits())
  }, [])

  const refreshAll = useCallback(() => {
    window.api.library.getAll().then(setRows).catch(() => {
      toast('Failed to load library', 'error')
    })
    window.api.starred.getAll().then(setStarredRows).catch(() => {})
    window.api.starred.getRecentlyUnstarred().then(setUnstarredRows).catch(() => {})
  }, [toast])

  // Trailing-edge debounce for event-driven refreshes so bursts of
  // `library:changed` + status events coalesce into one IPC round-trip.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      refreshAll()
    }, 150)
  }, [refreshAll])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    window.addEventListener('library:changed', scheduleRefresh)
    return () => window.removeEventListener('library:changed', scheduleRefresh)
  }, [scheduleRefresh])

  useEffect(() => {
    const cb = () => scheduleRefresh()
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [scheduleRefresh])

  useEffect(() => {
    const onStatusChanged = ({ ids }: { ids: string[] }) => {
      if (!ids.length) return
      scheduleRefresh()
    }
    const onToast = ({ message }: { message: string }) => {
      toast(message, 'success')
    }
    window.api.updates.onStatusChanged(onStatusChanged)
    window.api.updates.onToast(onToast)
    return () => {
      window.api.updates.offStatusChanged(onStatusChanged)
      window.api.updates.offToast(onToast)
    }
  }, [scheduleRefresh, toast])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  // Prime RepoDetail's per-repo cache from rows we already have in memory,
  // so first-time navigation to a sidebar repo shows its header/description/
  // stats immediately instead of waiting for fetchRepoBundle.
  // RepoDetail still types this as RepoRow until Task 10 migrates it.
  useEffect(() => {
    primeRepoCacheFromRows(
      [...rows, ...starredRows, ...unstarredRows] as unknown as Parameters<typeof primeRepoCacheFromRows>[0],
    )
  }, [rows, starredRows, unstarredRows])

  const repoSelectedId = useMemo(() => {
    if (!repoMatch) return null
    const { owner, name } = repoMatch.params
    return (
      rows.find(r => r.owner === owner && r.name === name)?.fullName ??
      starredRows.find(r => r.owner === owner && r.name === name)?.fullName ??
      null
    )
  }, [repoMatch, rows, starredRows])

  const collSelectedId = collMatch?.params.id ?? null

  const selectedLocalPath = location.pathname === '/local-project'
    ? new URLSearchParams(location.search).get('path')
    : null

  const handleRepoSelect = useCallback((row: SavedRepo, _isInstalled: boolean) => {
    prewarmStaticDither(row.ownerAvatarUrl, cameraIdxForRepo(row.owner, row.name))
    recordRecentVisit({ owner: row.owner, name: row.name, avatar_url: row.ownerAvatarUrl, navigatePath: `/library/repo/${row.owner}/${row.name}` })
    refreshRecentVisits()
    navigate(`/library/repo/${row.owner}/${row.name}`)
  }, [navigate, refreshRecentVisits])

  const handleLocalSelect = useCallback((project: LocalProject) => {
    const navPath = project.owner && project.repoName
      ? `/library/repo/${project.owner}/${project.repoName}`
      : `/local-project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}&git=${project.isGit ? '1' : '0'}`
    recordRecentVisit({ owner: project.owner ?? '', name: project.repoName ?? project.name, avatar_url: null, navigatePath: navPath })
    refreshRecentVisits()
    navigate(navPath)
  }, [navigate, refreshRecentVisits])

  const handleCollSelect = useCallback((id: string, coll: CollectionRow) => {
    navigate(`/library/collection/${id}`, { state: { coll, collectionName: coll.name } })
  }, [navigate])

  const pageTitle = (() => {
    if (repoMatch) return `${repoMatch.params.owner} / ${repoMatch.params.name}`
    if (collMatch) {
      const st = location.state as { collectionName?: string } | null
      return st?.collectionName ?? 'Collection'
    }
    if (agentMatch) return 'Agent'
    return 'Activity'
  })()

  return (
    <div className="library-root-v2">
      <header className="library-page-header" aria-label={pageTitle}>
        <span className="library-page-title">{pageTitle}</span>
      </header>

      <div className="library-body">
        <div className={`library-panel${isMiniTab ? ' mini' : ''}`}>
          <LibrarySidebar
            installedRows={rows}
            starredRows={starredRows}
            unstarredRows={unstarredRows}
            localProjects={localProjects}
            archivedSet={archivedSet}
            selectedId={repoSelectedId}
            selectedLocalPath={selectedLocalPath}
            collSelectedId={collSelectedId}
            onSelect={handleRepoSelect}
            onSelectLocal={handleLocalSelect}
            onSelectColl={handleCollSelect}
            onModeChange={setMode}
          />
        </div>

        <main className="library-main">
          <div className="library-detail-area">
            {hasDetail ? (
              <LibraryDetailRoutes />
            ) : mode === 'agents' ? (
              <AgentsLanding />
            ) : (
              <ActivityFeed />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
