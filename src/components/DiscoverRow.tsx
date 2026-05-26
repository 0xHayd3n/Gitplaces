import { useState, useEffect, useMemo } from 'react'
import './DiscoverRow.css'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import { type RepoRow } from '../types/repo'

interface DiscoverRowProps {
  repos: RepoRow[]
  activeIndex: number
  columns: number
  onNavigate: (path: string) => void
  onAdvance: (delta: number) => void
  title?: string
  onMore?: () => void
  onPause?: (paused: boolean) => void
}

// Emoji shortcode parser kept local — RepoCard exports a similar table but we
// avoid coupling so DiscoverRow stays portable if RepoCard's surface changes.
const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦',
  star:'⭐', sparkles:'✨', heart:'❤️', brain:'🧠', robot:'🤖',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

function DiscoverRowCardItem({
  repo, posIndex, columns, visible, onNavigate,
}: {
  repo: RepoRow
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
}) {
  const [desc, setDesc] = useState<string | null>(() => {
    if (repo.detected_language && repo.detected_language !== 'en' && repo.translated_description) {
      return repo.translated_description
    }
    return repo.description
  })

  useEffect(() => {
    setDesc(() => {
      if (repo.detected_language && repo.detected_language !== 'en' && repo.translated_description) {
        return repo.translated_description
      }
      return repo.description
    })
    if (!repo.description || repo.description.length < 6) return
    async function maybeTranslate() {
      try {
        const preferredLang = await window.api.settings.getPreferredLanguage().catch(() => 'en')
        if (repo.translated_description && repo.translated_description_lang === preferredLang) {
          setDesc(repo.translated_description)
          return
        }
        const scriptLang = await window.api.translate.check(repo.description!, preferredLang, 6).catch(() => null)
        if (!scriptLang) return
        const result = await window.api.translate.translate(repo.description!, preferredLang).catch(() => null)
        if (!result) return
        setDesc(result.translatedText)
        if (repo.id) {
          window.api.db.cacheTranslatedDescription(repo.id, result.translatedText, preferredLang, scriptLang).catch(() => {})
        }
      } catch { /* non-critical */ }
    }
    maybeTranslate()
  }, [repo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(repo.type_sub)
  const pillAccent = typeConfig?.accentColor ?? (repo.type_bucket ? getBucketColor(repo.type_bucket) : null)
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(repo.type_bucket))
  const isPeek = posIndex < 0 || posIndex >= visible
  const isActive = posIndex === 0
  const GAP = 16
  const cardWidth = `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`
  const cardLeft = posIndex === 0
    ? '0px'
    : `calc(${posIndex} * (100% + ${GAP}px))`

  const parsedDescription = useMemo(() => parseEmoji(desc ?? ''), [desc])

  return (
    <button
      key={repo.id}
      className={`discover-row-card${isPeek ? ' discover-row-card--peek' : isActive ? ' discover-row-card--p0' : ''}${repo.starred_at ? ' discover-row-card--starred' : ''}`}
      style={{ width: cardWidth, transform: `translateX(${cardLeft})` } as React.CSSProperties}
      onClick={!isPeek ? () => onNavigate(`/repo/${repo.owner}/${repo.name}`) : undefined}
      aria-label={`${repo.owner}/${repo.name}`}
      tabIndex={isPeek ? -1 : undefined}
      aria-hidden={isPeek}
    >
      <div className="repo-card-image">
        <DitherBackground avatarUrl={repo.avatar_url} fallbackGradient={gradient} />
        {repo.language && (
          <span className="repo-card-lang-overlay" title={repo.language}>
            <LanguageIcon lang={repo.language} size={18} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{repo.name}</div>
          <span className="repo-card-author">by {repo.owner}</span>
        </div>
        {typeConfig && pillAccent && repo.type_sub && (
          <span
            className="repo-card-pill"
            style={{ '--pill-accent': pillAccent } as React.CSSProperties}
          >
            {typeConfig.icon && (
              <span className="repo-card-pill-icon">
                <typeConfig.icon size={10} fill="currentColor" />
              </span>
            )}
            {typeConfig.label}
          </span>
        )}
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
      </div>
    </button>
  )
}

export default function DiscoverRow({ repos, activeIndex, columns, onNavigate, onAdvance, title = 'Recommended for You', onMore, onPause }: DiscoverRowProps) {
  if (repos.length === 0) return null

  const visible = Math.min(columns, repos.length)
  const slots: { repo: RepoRow; posIndex: number }[] = Array.from({ length: visible }, (_, i) => ({
    repo: repos[(activeIndex + i) % repos.length],
    posIndex: i,
  }))

  if (repos.length > visible) {
    slots.unshift({
      repo: repos[(activeIndex - 1 + repos.length) % repos.length],
      posIndex: -1,
    })
  }
  if (repos.length >= visible + 2) {
    slots.push({
      repo: repos[(activeIndex + visible) % repos.length],
      posIndex: visible,
    })
  }

  const atStart = activeIndex === 0
  const atEnd = activeIndex >= Math.max(0, repos.length - visible)

  return (
    <div className="discover-row">
      <div className="discover-row-header">
        {onMore ? (
          <button className="discover-row-title-btn" onClick={onMore} aria-label={`See all ${title}`}>
            <span>{title}</span>
            <span className="discover-row-title-chevron" aria-hidden="true">›</span>
          </button>
        ) : (
          <span className="discover-row-title-static">{title}</span>
        )}
      </div>
      <div
        className="discover-row-carousel"
        onMouseEnter={() => onPause?.(true)}
        onMouseLeave={() => onPause?.(false)}
      >
        {slots.map(({ repo, posIndex }) => (
          <DiscoverRowCardItem
            key={repo.id}
            repo={repo}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={onNavigate}
          />
        ))}
        <button
          className="discover-row-nav-zone discover-row-nav-zone--prev"
          onClick={() => onAdvance(-1)}
          disabled={atStart}
          aria-label="Previous"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          className="discover-row-nav-zone discover-row-nav-zone--next"
          onClick={() => onAdvance(1)}
          disabled={atEnd}
          aria-label="Next"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
