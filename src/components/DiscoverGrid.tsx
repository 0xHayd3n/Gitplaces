import { useState, type RefObject } from 'react'
import type { SavedRepo } from '../types/repo'
import type { Anchor } from '../types/recommendation'
import type { LayoutPrefs } from './LayoutDropdown'
import type { useVerification } from '../hooks/useVerification'
import type { ViewModeKey } from '../lib/discoverQueries'
import RepoCard from './RepoCard'
import RepoListRow from './RepoListRow'
import ViewportWindow from './ViewportWindow'

export interface DiscoverGridProps {
  loading: boolean
  loadingMore: boolean
  error: string | null
  visibleRepos: SavedRepo[]
  discoverQuery: string
  layoutPrefs: LayoutPrefs
  sentinelRef: RefObject<HTMLDivElement>
  gridRef: RefObject<HTMLDivElement>
  verification: ReturnType<typeof useVerification>
  onNavigate: (path: string) => void
  onTagClick: (tag: string) => void
  onOwnerClick: (owner: string) => void
  focusIndex?: number
  viewMode?: ViewModeKey
  onStar?: (repoId: string, starred: boolean) => void
  onLanguageClick?: (lang: string) => void
  onSubtypeClick?: (subtypeId: string) => void
  anchorsByRepoId?: Map<string, Anchor[]>
}

export default function DiscoverGrid({
  loading,
  loadingMore,
  error,
  visibleRepos,
  discoverQuery,
  layoutPrefs,
  sentinelRef,
  gridRef,
  verification,
  onNavigate,
  onTagClick,
  onOwnerClick,
  focusIndex = -1,
  viewMode,
  onStar,
  onLanguageClick,
  onSubtypeClick,
  anchorsByRepoId,
}: DiscoverGridProps) {
  const [expandedTagsRepo, setExpandedTagsRepo] = useState<string | null>(null)

  const effectiveCols = layoutPrefs.columns

  // Skeleton loading
  if (loading) {
    if (layoutPrefs.mode === 'list') {
      return (
        <div className="discover-list">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="repo-list-row repo-list-row--comfortable" style={{
              height: 52, background: 'var(--bg3)',
              animation: 'shimmer 1.5s infinite',
            }} />
          ))}
        </div>
      )
    }
    return (
      <div
        className="discover-grid"
        data-cols={effectiveCols}
        style={{
          gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: effectiveCols * 3 }).map((_, i) => (
          <div key={i} className="repo-card-skeleton">
            <div className="repo-card-skeleton-image shimmer" />
            <div className="repo-card-skeleton-info">
              <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 4 }} />
              <div className="shimmer" style={{ width: '80%', height: 8, borderRadius: 4, marginTop: 6 }} />
              <div className="shimmer" style={{ width: '40%', height: 8, borderRadius: 4, marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Empty state
  if (!error && visibleRepos.length === 0 && discoverQuery.trim()) {
    return (
      <div style={{
        gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center',
        color: 'var(--t3)', fontSize: 13,
      }}>
        <div style={{ marginBottom: 8 }}>No repos found for &ldquo;{discoverQuery}&rdquo;</div>
        <div style={{ fontSize: 11 }}>
          Try broadening your search or removing filters
        </div>
      </div>
    )
  }

  // No repos to show
  if (error || visibleRepos.length === 0) return null

  // List mode
  if (layoutPrefs.mode === 'list') {
    return (
    <>
      <div className="discover-list">
        <div className="repo-list-header">
          <div className="repo-list-header-col repo-list-header-type">Type</div>
          <div className="repo-list-header-sep" />
          <div className="repo-list-header-col repo-list-header-repo">Repository</div>
          <div className="repo-list-header-sep" />
          <div className="repo-list-header-col repo-list-header-tags">Tags</div>
          <div className="repo-list-header-sep" />
          <div className="repo-list-header-col repo-list-header-stats">Stats</div>
        </div>
        {visibleRepos.map((repo, i) => (
          <ViewportWindow
            key={`${repo.owner}/${repo.name}`}
            placeholderHeight={52}
          >
            <RepoListRow
              repo={repo}
              onNavigate={onNavigate}
              onTagClick={onTagClick}
              onOwnerClick={onOwnerClick}
              typeSub={repo.typeSub}
              verificationTier={verification.getTier(String(repo.hostNativeId))}
              verificationSignals={verification.getSignals(String(repo.hostNativeId))}
              verificationResolving={verification.isResolving(String(repo.hostNativeId))}
              density={layoutPrefs.density}
              fields={layoutPrefs.fields}
              focused={i === focusIndex}
              tagsExpanded={expandedTagsRepo === `${repo.owner}/${repo.name}`}
              onToggleTags={() => setExpandedTagsRepo(prev =>
                prev === `${repo.owner}/${repo.name}` ? null : `${repo.owner}/${repo.name}`
              )}
            />
          </ViewportWindow>
        ))}
        {loadingMore && Array.from({ length: 3 }).map((_, i) => (
          <div key={`skel-${i}`} className="repo-list-row repo-list-row--comfortable" style={{
            height: 52, background: 'var(--bg3)',
            animation: 'shimmer 1.5s infinite',
          }} />
        ))}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </>
    )
  }

  // Grid mode
  return (
    <>
      <div
        ref={gridRef}
        className="discover-grid"
        data-cols={effectiveCols}
        style={{
          gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
        }}
      >
        {visibleRepos.map((repo, i) => (
          <ViewportWindow
            key={String(repo.hostNativeId) || `${repo.owner}/${repo.name}`}
            placeholderHeight={280}
          >
            <RepoCard
              repo={repo}
              onNavigate={onNavigate}
              typeSub={repo.typeSub}
              typeBucket={repo.typeBucket}
              focused={i === focusIndex}
              onLanguageClick={onLanguageClick}
              onSubtypeClick={onSubtypeClick}
            />
          </ViewportWindow>
        ))}
        {loadingMore && Array.from({ length: effectiveCols }).map((_, i) => (
          <div key={`skel-${i}`} className="repo-card-skeleton">
            <div className="repo-card-skeleton-image shimmer" />
            <div className="repo-card-skeleton-info">
              <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 4 }} />
              <div className="shimmer" style={{ width: '80%', height: 8, borderRadius: 4, marginTop: 6 }} />
              <div className="shimmer" style={{ width: '40%', height: 8, borderRadius: 4, marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </>
  )
}
