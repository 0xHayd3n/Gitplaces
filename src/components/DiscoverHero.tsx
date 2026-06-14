import { useState, useEffect, useRef } from 'react'
import './DiscoverHero.css'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getLangColor } from '../lib/languages'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import type { SavedRepo } from '../types/repo'

interface DiscoverHeroProps {
  repo: SavedRepo | null
  onNavigate?: (path: string) => void
}

interface LayerProps {
  repo: SavedRepo
  animClass: string
}

function HeroLayer({ repo, animClass }: LayerProps) {
  const langColor = getLangColor(repo.language)
  const typeConfig = getSubTypeConfig(repo.typeSub)

  // Use cached translation if the description is non-English, or resolve async
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

  return (
    <div className={`discover-hero-layer ${animClass}`}>
      <DitherBackground avatarUrl={repo.ownerAvatarUrl} />
      <div className="discover-hero-fade-top" />
      <div className="discover-hero-fade" />
      <div className="discover-hero-content">
        <div className="discover-hero-text">
          <div className="discover-hero-title-row">
            {repo.ownerAvatarUrl && (
              <img className="discover-hero-avatar-img" src={repo.ownerAvatarUrl} alt={repo.owner} />
            )}
            <div className="discover-hero-title">{repo.name}</div>
          </div>
          {desc && <div className="discover-hero-desc">{desc}</div>}
          {(repo.language || typeConfig) && (
            <div className="discover-hero-badges">
              {typeConfig && (
                <div className="discover-hero-pill" style={{ '--pill-accent': typeConfig.accentColor } as React.CSSProperties}>
                  {typeConfig.icon && (
                    <span className="discover-hero-pill-icon">
                      <typeConfig.icon size={12} fill="currentColor" />
                    </span>
                  )}
                  {typeConfig.label}
                </div>
              )}
              {repo.language && (
                <div className="discover-hero-pill" style={{ '--pill-accent': langColor } as React.CSSProperties}>
                  <span className="discover-hero-pill-icon">
                    <LanguageIcon lang={repo.language} size={14} boxed />
                  </span>
                  {repo.language}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DiscoverHero({ repo, onNavigate }: DiscoverHeroProps) {
  const [shownRepo, setShownRepo] = useState<SavedRepo | null>(repo)
  const [outgoingRepo, setOutgoingRepo] = useState<SavedRepo | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!repo || repo.hostNativeId === shownRepo?.hostNativeId) return

    if (timerRef.current) clearTimeout(timerRef.current)

    setOutgoingRepo(shownRepo)
    setShownRepo(repo)

    timerRef.current = setTimeout(() => {
      setOutgoingRepo(null)
    }, 520)
  }, [repo?.hostNativeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  if (!shownRepo && !outgoingRepo) return null

  return (
    <div
      className="discover-hero"
      onClick={() => { if (shownRepo) onNavigate?.(`/repo/${shownRepo.owner}/${shownRepo.name}`) }}
    >
      {outgoingRepo && (
        <HeroLayer key={String(outgoingRepo.hostNativeId) + '-out'} repo={outgoingRepo} animClass="discover-hero-layer--out" />
      )}
      {shownRepo && (
        <HeroLayer key={String(shownRepo.hostNativeId) + '-in'} repo={shownRepo} animClass={outgoingRepo ? 'discover-hero-layer--in' : 'discover-hero-layer--stable'} />
      )}
    </div>
  )
}
