import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useMatch, useLocation, Routes, Route } from 'react-router-dom'
import { type LibraryRow, type StarredRepoRow, type RepoRow } from '../types/repo'
import type { CollectionRow } from '../types/repo'
import type { LocalProject } from '../types/library'
import { useToast } from '../contexts/Toast'
import { useRepoNav } from '../contexts/RepoNav'
import { useArchivedRepos } from '../hooks/useArchivedRepos'
import { getRecentVisits, recordRecentVisit } from '../lib/recentVisits'
import type { RecentEntry } from '../lib/recentVisits'
import LibrarySidebar from '../components/LibrarySidebar'
import RepoDetail from './RepoDetail'
import CollectionDetail from './CollectionDetail'
import ActivityFeed from '../components/ActivityFeed'

export default function Library() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { state: repoNav } = useRepoNav()
  const { archivedSet } = useArchivedRepos()
  const location = useLocation()
  const isMiniTab = repoNav.activeTab === 'files' || repoNav.activeTab === 'components'

  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null

  const [rows, setRows] = useState<LibraryRow[]>([])
  const [starredRows, setStarredRows] = useState<StarredRepoRow[]>([])
  const [unstarredRows, setUnstarredRows] = useState<StarredRepoRow[]>([])
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
            <ActivityFeed />
          )}
        </div>
      </main>
    </div>
  )
}
