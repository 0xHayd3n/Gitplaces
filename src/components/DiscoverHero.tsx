import { useState, useEffect, useRef } from 'react'
import './DiscoverHero.css'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getLangColor } from '../lib/languages'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import type { RepoRow } from '../types/repo'

interface DiscoverHeroProps {
  repo: RepoRow | null
  onNavigate?: (path: string) => void
}

interface LayerProps {
  repo: RepoRow
  animClass: string
}

function HeroLayer({ repo, animClass }: LayerProps) {
  const langColor = getLangColor(repo.language)
  const typeConfig = getSubTypeConfig(repo.type_sub)

  // Use cached translation if the description is non-English, or resolve async
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

  return (
    <div className={`discover-hero-layer ${animClass}`}>
      <DitherBackground avatarUrl={repo.avatar_url} />
      <div className="discover-hero-fade-top" />
      <div className="discover-hero-fade" />
      <div className="discover-hero-content">
        <div className="discover-hero-text">
          <div className="discover-hero-title-row">
            {repo.avatar_url && (
              <img className="discover-hero-avatar-img" src={repo.avatar_url} alt={repo.owner} />
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
          {repo.owner && (
            <div className="discover-hero-owner-row">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="discover-hero-owner-icon">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
              <span className="discover-hero-owner">{repo.owner}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DiscoverHero({ repo, onNavigate }: DiscoverHeroProps) {
  const [shownRepo, setShownRepo] = useState<RepoRow | null>(repo)
  const [outgoingRepo, setOutgoingRepo] = useState<RepoRow | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!repo || repo.id === shownRepo?.id) return

    if (timerRef.current) clearTimeout(timerRef.current)

    setOutgoingRepo(shownRepo)
    setShownRepo(repo)

    timerRef.current = setTimeout(() => {
      setOutgoingRepo(null)
    }, 520)
  }, [repo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  if (!shownRepo && !outgoingRepo) return null

  return (
    <div
      className="discover-hero"
      onClick={() => { if (shownRepo) onNavigate?.(`/repo/${shownRepo.owner}/${shownRepo.name}`) }}
    >
      {outgoingRepo && (
        <HeroLayer key={outgoingRepo.id + '-out'} repo={outgoingRepo} animClass="discover-hero-layer--out" />
      )}
      {shownRepo && (
        <HeroLayer key={shownRepo.id + '-in'} repo={shownRepo} animClass={outgoingRepo ? 'discover-hero-layer--in' : 'discover-hero-layer--stable'} />
      )}
    </div>
  )
}
