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
      className={`fork-repo-card${isFork ? ' fork-repo-card--fork' : ''}`}
      href={`https://github.com/${owner}/${name}`}
      target="_blank"
      rel="noreferrer"
    >
      <div className="fork-repo-card__dither">
        <DitherBackground avatarUrl={avatarUrl} fallbackGradient={fallbackGradient} />
        {isFork && <span className="fork-repo-card__fork-badge">fork</span>}
      </div>
      <div className="fork-repo-card__info">
        <div className="fork-repo-card__title-row">
          <img
            className="fork-repo-card__avatar"
            src={avatarUrl}
            alt={owner}
            width={28}
            height={28}
          />
          <span className="fork-repo-card__name">{name}</span>
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
        {description && <p className="fork-repo-card__desc">{description}</p>}
        <div className="fork-repo-card__creator">
          <img
            className="fork-repo-card__creator-avatar"
            src={avatarUrl}
            alt={owner}
            width={16}
            height={16}
          />
          <span className="fork-repo-card__creator-name">{owner}</span>
        </div>
        <div className="fork-repo-card__stats">
          <span>★ {formatCount(stars)}</span>
          {!isFork && <span>⑂ {formatCount(forks)}</span>}
        </div>
      </div>
    </a>
  )
}

export function ForkRepoCardSkeleton() {
  return (
    <div className="fork-repo-card fork-repo-card--skeleton">
      <div className="fork-repo-card__dither fork-repo-card__dither--loading" />
      <div className="fork-repo-card__info">
        <div className="fork-repo-card__title-row">
          <div className="frcs frcs--avatar" />
          <div className="frcs frcs--name" />
          <div className="frcs frcs--badge" />
        </div>
        <div className="frcs frcs--desc-full" />
        <div className="frcs frcs--desc-short" />
        <div className="fork-repo-card__creator">
          <div className="frcs frcs--creator-avatar" />
          <div className="frcs frcs--creator-name" />
        </div>
        <div className="frcs frcs--stats" />
      </div>
    </div>
  )
}
