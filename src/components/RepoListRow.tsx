import { useEffect, useRef } from 'react'
import type { SavedRepo } from '../types/repo'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import type { ListDensity, ListFields } from './LayoutDropdown'
import { formatCount } from './RepoCard'
import { Star, GitFork, Clock } from 'lucide-react'
import VerificationBadge from './VerificationBadge'
import { useLearningProgress } from '../hooks/useLearningProgress'

interface RepoListRowProps {
  repo: SavedRepo
  onNavigate: (path: string) => void
  onTagClick: (tag: string) => void
  onOwnerClick?: (owner: string) => void
  typeSub?: string | null
  verificationTier?: 'verified' | 'likely' | null
  verificationSignals?: string[]
  verificationResolving?: boolean
  density: ListDensity
  fields: ListFields
  focused?: boolean
  tagsExpanded?: boolean
  onToggleTags?: () => void
}

function formatRecency(updatedAt: string): string {
  if (!updatedAt) return ''
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000)
  if (days < 1)   return 'today'
  if (days < 7)   return `${days}d ago`
  if (days < 30)  return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function RepoListRow({
  repo, onNavigate, onTagClick, onOwnerClick,
  typeSub, verificationTier, verificationSignals, verificationResolving,
  density, fields, focused, tagsExpanded = false, onToggleTags,
}: RepoListRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const allTopics = repo.topics
  const visibleTopics = tagsExpanded ? allTopics : allTopics.slice(0, 3)
  const moreCount = allTopics.length - 3
  const typeConfig = getSubTypeConfig(typeSub)
  const { state: learnState } = useLearningProgress(repo.owner, repo.name)
  const isLearning = !!learnState && learnState.state === 'running'

  useEffect(() => {
    if (focused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [focused])

  return (
    <div
      ref={rowRef}
      className={`repo-list-row repo-list-row--${density}${focused ? ' kb-focused' : ''}${isLearning ? ' learning' : ''}`}
      onClick={() => onNavigate(`/repo/${repo.owner}/${repo.name}`)}
      style={{ cursor: 'pointer', '--row-accent': typeConfig?.accentColor ?? 'rgba(255,255,255,0.15)' } as React.CSSProperties}
    >
      {/* Type icon column */}
      <div className="repo-list-row-type-col">
        {fields.type && typeConfig && typeConfig.icon && (
          <span className="repo-list-row-type-icon" style={{ color: typeConfig.accentColor }} title={typeConfig.label}>
            {(() => { const Icon = typeConfig.icon!; return <Icon size={14} /> })()}
          </span>
        )}
      </div>

      {/* Accent separator between type and repo */}
      <div className="repo-list-row-accent" />

      {/* Avatar + identity */}
      <div className="repo-list-row-identity">
        <div style={{ flexShrink: 0 }}>
          <img
            src={`https://github.com/${repo.owner}.png?size=24`}
            alt={repo.owner}
            width={24} height={24}
            style={{ borderRadius: '50%' }}
            onClick={e => { e.stopPropagation(); onOwnerClick?.(repo.owner) }}
          />
        </div>
        <div className="repo-list-row-body">
          <div className="repo-list-row-title">
            <span className="repo-list-row-name">{repo.name}</span>
            <span className="repo-list-row-owner">{repo.owner}</span>
            {fields.type && typeConfig && (
              <span className="repo-list-row-type" style={{ color: typeConfig.accentColor }}>
                {typeConfig.icon && (() => { const Icon = typeConfig.icon!; return <Icon size={10} /> })()}
                {typeConfig.label}
              </span>
            )}
            {fields.verification && (
              <VerificationBadge
                tier={verificationTier ?? null}
                signals={verificationSignals ?? []}
                resolving={verificationResolving}
                size="sm"
                variant="icon"
              />
            )}
          </div>
          {fields.description && repo.description && (
            <div className="repo-list-row-description">{repo.description}</div>
          )}
        </div>
      </div>

      {/* Tags column with separator */}
      <div className="repo-list-row-sep" />
      <div className="repo-list-row-tags-col" onClick={e => e.stopPropagation()}>
        {fields.tags && visibleTopics.length > 0 && (
          <>
            <div className={`repo-list-row-tags${tagsExpanded ? ' expanded' : ''}`}>
              {visibleTopics.map(tag => (
                <button
                  key={tag}
                  className="repo-list-row-tag"
                  onClick={e => { e.stopPropagation(); onTagClick(tag) }}
                >
                  {tag}
                </button>
              ))}
              {moreCount > 0 && (
                <button
                  className="repo-list-row-tags-more"
                  onClick={e => { e.stopPropagation(); onToggleTags?.() }}
                >
                  {tagsExpanded ? 'show less' : `+${moreCount} more`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: stats */}
      <div className="repo-list-row-sep" />
      <div className="repo-list-row-actions" onClick={e => e.stopPropagation()}>
        {fields.stats && (
          <div className="repo-list-row-stats">
            <span><Star size={11} /> {formatCount(repo.stars)}</span>
            <span><GitFork size={11} /> {formatCount(repo.forks)}</span>
            <span><Clock size={11} /> {formatRecency(repo.updatedAt)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
