import { useState, useEffect, useMemo } from 'react'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getSubTypeConfig, getBucketColor } from '../config/repoTypeConfig'
import type { SavedRepo } from '../types/repo'

const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦',
  star:'⭐', sparkles:'✨', heart:'❤️', brain:'🧠', robot:'🤖',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

export interface DiscoverRowRepoCardProps {
  repo: SavedRepo
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
  onLanguageClick?: (lang: string) => void
}

export default function DiscoverRowRepoCard({
  repo, posIndex, columns, visible, onNavigate, onLanguageClick,
}: DiscoverRowRepoCardProps) {
  const [desc, setDesc] = useState<string | null>(() => {
    if (repo.detectedLanguage && repo.detectedLanguage !== 'en' && repo.translatedDescription) {
      return repo.translatedDescription
    }
    return repo.description
  })

  useEffect(() => {
    setDesc(() => {
      if (repo.detectedLanguage && repo.detectedLanguage !== 'en' && repo.translatedDescription) {
        return repo.translatedDescription
      }
      return repo.description
    })
    if (!repo.description || repo.description.length < 6) return
    async function maybeTranslate() {
      try {
        const preferredLang = await window.api.settings.getPreferredLanguage().catch(() => 'en')
        if (repo.translatedDescription && repo.translatedDescriptionLang === preferredLang) {
          setDesc(repo.translatedDescription)
          return
        }
        const scriptLang = await window.api.translate.check(repo.description!, preferredLang, 6).catch(() => null)
        if (!scriptLang) return
        const result = await window.api.translate.translate(repo.description!, preferredLang).catch(() => null)
        if (!result) return
        setDesc(result.translatedText)
        const repoDbId = String(repo.hostNativeId)
        if (repoDbId) {
          window.api.db.cacheTranslatedDescription(repoDbId, result.translatedText, preferredLang, scriptLang).catch(() => {})
        }
      } catch { /* non-critical */ }
    }
    maybeTranslate()
  }, [repo.hostNativeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(repo.typeSub)
  const pillAccent = typeConfig?.accentColor ?? (repo.typeBucket ? getBucketColor(repo.typeBucket) : null)
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
      key={String(repo.hostNativeId)}
      className={`discover-row-card${isPeek ? ' discover-row-card--peek' : isActive ? ' discover-row-card--p0' : ''}${repo.starredAt ? ' discover-row-card--starred' : ''}`}
      style={{ width: cardWidth, transform: `translateX(${cardLeft})` } as React.CSSProperties}
      onClick={!isPeek ? () => onNavigate(`/repo/${repo.owner}/${repo.name}`) : undefined}
      aria-label={`${repo.owner}/${repo.name}`}
      tabIndex={isPeek ? -1 : undefined}
      aria-hidden={isPeek}
    >
      <div className="repo-card-image">
        <div className="repo-card-image-canvas">
          <DitherBackground avatarUrl={repo.ownerAvatarUrl} />
        </div>
        {repo.language && (
          <span
            className="repo-card-lang-overlay"
            onClick={e => { e.stopPropagation(); onLanguageClick?.(repo.language!) }}
            title={repo.language}
          >
            <LanguageIcon lang={repo.language} size={26} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title">{repo.name}</div>
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
        <div className="repo-card-pill-row">
          {typeConfig && pillAccent && repo.typeSub && (
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
        </div>
      </div>
    </button>
  )
}
