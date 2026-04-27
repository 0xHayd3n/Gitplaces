import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useMatch, Routes, Route } from 'react-router-dom'
import { type LibraryRow, type StarredRepoRow, type RepoRow } from '../types/repo'
import type { CollectionRow } from '../types/repo'
import { useToast } from '../contexts/Toast'
import { useRepoNav } from '../contexts/RepoNav'
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
  const isMiniTab = repoNav.activeTab === 'files' || repoNav.activeTab === 'components'

  const repoMatch  = useMatch('/library/repo/:owner/:name')
  const collMatch  = useMatch('/library/collection/:id')
  const hasDetail  = repoMatch !== null || collMatch !== null

  const [activePanel, setActivePanel] = useState<ActivePanel>('repos')
  const [rows, setRows] = useState<LibraryRow[]>([])
  const [starredRows, setStarredRows] = useState<StarredRepoRow[]>([])
  const [activeSegment, setActiveSegment] = useState<'all' | 'active' | 'inactive'>('all')

  const refreshRows = useCallback(() => {
    window.api.library.getAll().then(setRows).catch(() => {
      toast('Failed to load library', 'error')
    })
  }, [toast])

  useEffect(() => {
    refreshRows()
    window.api.starred.getAll().then(setStarredRows).catch(() => {})
  }, [refreshRows])

  useEffect(() => {
    window.addEventListener('library:changed', refreshRows)
    return () => window.removeEventListener('library:changed', refreshRows)
  }, [refreshRows])

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

  const handlePanelToggle = useCallback((panel: 'repos' | 'collections') => {
    setActivePanel(panel)
  }, [])

  const handleRepoSelect = useCallback((row: RepoRow, _isInstalled: boolean) => {
    navigate(`/library/repo/${row.owner}/${row.name}`)
  }, [navigate])

  const handleCollSelect = useCallback((id: string, coll: CollectionRow) => {
    navigate(`/library/collection/${id}`, { state: { coll, collectionName: coll.name } })
  }, [navigate])

  return (
    <div className="library-root-v2">
      <NavRail activePanel={activePanel} onPanelToggle={handlePanelToggle} />

      <div
        className={`library-panel${activePanel === 'repos' ? '' : ' collapsed'}${isMiniTab ? ' mini' : ''}`}
        aria-hidden={activePanel !== 'repos'}
      >
        <LibrarySidebar
          installedRows={rows}
          starredRows={starredRows}
          selectedId={repoSelectedId}
          activeSegment={activeSegment}
          onSegmentChange={setActiveSegment}
          onSelect={handleRepoSelect}
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
