import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getLangColor } from '../lib/languages'
import { formatCount } from './RepoCard'
import './ForkRepoCard.css'

interface ForkRepoCardProps {
  owner: string
  name: string
  avatarUrl: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  isFork: boolean
}

export function ForkRepoCard({
  owner, name, avatarUrl, description, language, stars, forks, isFork,
}: ForkRepoCardProps) {
  const fallbackGradient: [string, string] = language
    ? [getLangColor(language), '#0d1117']
    : ['#1a1f2e', '#0d1117']

  return (
    <a
      className={`repo-card fork-repo-card${isFork ? ' fork-repo-card--fork' : ''}`}
      href={`https://github.com/${owner}/${name}`}
      target="_blank"
      rel="noreferrer"
    >
      <div className="repo-card-dither">
        <DitherBackground avatarUrl={avatarUrl} fallbackGradient={fallbackGradient} />
        {isFork && <span className="fork-repo-card__fork-pill">fork</span>}
      </div>

      <div className="repo-card-info">
        <div className="repo-card-top">
          <img className="repo-card-avatar" src={avatarUrl} alt="" loading="lazy" decoding="async" />
          <div className="repo-card-top-text">
            <div className="repo-card-name">{name}</div>
            {description && <p className="repo-card-desc">{description}</p>}
          </div>
        </div>

        <div className="repo-card-grow" />

        <div className="repo-card-footer">
          <div className="repo-card-footer-left">
            <div className="repo-card-stats">
              <span className="repo-card-stat repo-card-stat-owner">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
                {owner}
              </span>
              {stars != null && (
                <span className="repo-card-stat">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {formatCount(stars)}
                </span>
              )}
              {!isFork && forks != null && (
                <span className="repo-card-stat">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="2" />
                    <circle cx="18" cy="6" r="2" />
                    <circle cx="12" cy="18" r="2" />
                    <path d="M6 8v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
                    <path d="M12 12v4" />
                  </svg>
                  {formatCount(forks)}
                </span>
              )}
            </div>
          </div>
          <div className="repo-card-footer-badges">
            {language && (
              <span
                className="repo-card-icon-badge"
                style={{ '--badge-color': getLangColor(language) } as React.CSSProperties}
              >
                <span className="repo-card-icon-badge-icon">
                  <LanguageIcon lang={language} size={18} boxed />
                </span>
                <span className="repo-card-icon-badge-text">{language}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </a>
  )
}

export function ForkRepoCardSkeleton() {
  return (
    <div className="repo-card fork-repo-card fork-repo-card--skeleton">
      <div className="repo-card-dither" />
      <div className="repo-card-info">
        <div className="repo-card-top">
          <div className="frcs frcs--avatar" />
          <div className="repo-card-top-text">
            <div className="frcs frcs--name" />
            <div className="frcs frcs--desc" />
            <div className="frcs frcs--desc frcs--desc-short" />
          </div>
        </div>
        <div className="repo-card-grow" />
        <div className="repo-card-footer">
          <div className="repo-card-footer-left">
            <div className="frcs frcs--stat" />
          </div>
          <div className="repo-card-footer-badges">
            <div className="frcs frcs--badge" />
          </div>
        </div>
      </div>
    </div>
  )
}
