import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useMatch, useLocation, Routes, Route } from 'react-router-dom'
import { type LibraryRow, type StarredRepoRow, type RepoRow } from '../types/repo'
import type { CollectionRow } from '../types/repo'
import type { LocalProject, ActiveSegment } from '../types/library'
import { useToast } from '../contexts/Toast'
import { useRepoNav } from '../contexts/RepoNav'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useArchivedRepos } from '../hooks/useArchivedRepos'
import { getRecentVisits, recordRecentVisit } from '../lib/recentVisits'
import type { RecentEntry } from '../lib/recentVisits'
import NavRail from '../components/NavRail'
import LibrarySidebar from '../components/LibrarySidebar'
import CollectionsSidebar from '../components/CollectionsSidebar'
import RepoDetail from './RepoDetail'
import CollectionDetail from './CollectionDetail'

type ActivePanel = 'repos' | 'collections'

export default function Library() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { state: repoNav } = useRepoNav()
  const { user } = useGitHubAuth()
  const { archivedSet } = useArchivedRepos()
  const location = useLocation()
  const isMiniTab = repoNav.activeTab === 'files' || repoNav.activeTab === 'components'

  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null

  const [activePanel, setActivePanel] = useState<ActivePanel>('repos')
  const [rows, setRows] = useState<LibraryRow[]>([])
  const [starredRows, setStarredRows] = useState<StarredRepoRow[]>([])
  const [unstarredRows, setUnstarredRows] = useState<StarredRepoRow[]>([])
  const [activeSegment, setActiveSegment] = useState<ActiveSegment>('all')
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [recentVisits, setRecentVisits] = useState<RecentEntry[]>(() => getRecentVisits())

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

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    window.addEventListener('library:changed', refreshAll)
    return () => window.removeEventListener('library:changed', refreshAll)
  }, [refreshAll])

  useEffect(() => {
    const onStatusChanged = ({ ids }: { ids: string[] }) => {
      if (!ids.length) return
      refreshAll()
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
  }, [refreshAll, toast])

  useEffect(() => {
    if (collMatch) setActivePanel('collections')
    else if (repoMatch) setActivePanel('repos')
  }, [collMatch, repoMatch])

  useEffect(() => {
    window.api.settings.get('projectsFolder').then(folder => {
      if (folder) {
        window.api.projects?.scanFolder(folder).then(setLocalProjects).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  const repoSelectedId = useMemo(() => {
    if (!repoMatch) return null
    const { owner, name } = repoMatch.params
    return (
      rows.find(r => r.owner === owner && r.name === name)?.id ??
      starredRows.find(r => r.owner === owner && r.name === name)?.id ??
      null
    )
  }, [repoMatch, rows, starredRows])

  const collSelectedId = collMatch?.params.id ?? null

  const selectedLocalPath = location.pathname === '/local-project'
    ? new URLSearchParams(location.search).get('path')
    : null

  const handlePanelToggle = useCallback((panel: 'repos' | 'collections') => {
    setActivePanel(panel)
  }, [])

  const handleRepoSelect = useCallback((row: RepoRow, _isInstalled: boolean) => {
    recordRecentVisit({ owner: row.owner, name: row.name, avatar_url: row.avatar_url, navigatePath: `/library/repo/${row.owner}/${row.name}` })
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

  return (
    <div className="library-root-v2">
      <div className="discover-drag-strip" aria-hidden="true" />
      <NavRail activePanel={activePanel} onPanelToggle={handlePanelToggle} />

      <div
        className={`library-panel${activePanel === 'repos' ? '' : ' collapsed'}${isMiniTab ? ' mini' : ''}`}
        aria-hidden={activePanel !== 'repos'}
      >
        <LibrarySidebar
          installedRows={rows}
          starredRows={starredRows}
          unstarredRows={unstarredRows}
          localProjects={localProjects}
          archivedSet={archivedSet}
          recentVisits={recentVisits}
          githubUsername={user?.login ?? null}
          selectedId={repoSelectedId}
          selectedLocalPath={selectedLocalPath}
          activeSegment={activeSegment}
          onSegmentChange={setActiveSegment}
          onSelect={handleRepoSelect}
          onSelectLocal={handleLocalSelect}
        />
      </div>

      <div
        className={`library-panel${activePanel === 'collections' ? '' : ' collapsed'}`}
        aria-hidden={activePanel !== 'collections'}
      >
        <CollectionsSidebar
          selectedId={collSelectedId}
          onSelect={handleCollSelect}
        />
      </div>

      <main className="library-main">
        <div className="library-detail-area">
          {hasDetail ? (
            <Routes>
              <Route path="repo/:owner/:name" element={<RepoDetail />} />
              <Route path="collection/:id" element={<CollectionDetail />} />
            </Routes>
          ) : (
            <div className="library-detail-empty">
              <div className="library-detail-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <h2 className="library-detail-empty-title">Your Library</h2>
              <p className="library-detail-empty-sub">
                {rows.length > 0
                  ? <>{rows.length} skill{rows.length !== 1 ? 's' : ''} installed{starredRows.length > 0 ? ` · ${starredRows.length} starred` : ''}</>
                  : 'No skills installed yet'}
              </p>
              <p className="library-detail-empty-hint">Select a repo or collection from the sidebar to view details.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
