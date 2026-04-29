import DitherBackground from './DitherBackground'
import { relativeTime } from '../utils/relativeTime'
import './BannerCard.css'

export type BannerCardTier = 'normal' | 'major' | 'prerelease'

interface BannerCardProps {
  tag: string
  tier: BannerCardTier
  title: string
  descriptionPreview: string
  versionLabel: string
  ownerLogin: string
  repoFullName: string
  occurredAt: string
  onClick: () => void
}

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

export function BannerCard({
  tag, tier, title, descriptionPreview, versionLabel,
  ownerLogin, repoFullName, occurredAt, onClick,
}: BannerCardProps) {
  return (
    <div className={`banner-card banner-card--${tier}`} onClick={onClick}>
      <div className="banner-card__image">
        <DitherBackground
          avatarUrl={`https://github.com/${ownerLogin}.png?size=200`}
          fallbackGradient={tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
          staticFrame
        />
        <div className="banner-card__version-overlay">{versionLabel}</div>
      </div>
      <div className="banner-card__body">
        <span className={`banner-card__tag banner-card__tag--${tier}`}>{tag}</span>
        <span className="banner-card__title">{title}</span>
        <p className="banner-card__desc">{descriptionPreview}</p>
        <div className="banner-card__meta">
          <img src={`https://github.com/${ownerLogin}.png?size=40`} alt="" />
          <strong>{repoFullName}</strong>
          <span>·</span>
          <span>{relativeTime(occurredAt)}</span>
        </div>
      </div>
    </div>
  )
}
