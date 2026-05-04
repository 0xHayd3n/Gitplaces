import { memo } from 'react'
import DitherBackground from './DitherBackground'
import { relativeTime } from '../utils/relativeTime'
import './BannerCard.css'

export type BannerCardTier = 'normal' | 'major' | 'prerelease'

function TagIcon({ tag, tier }: { tag: string; tier: BannerCardTier }) {
  if (tag === 'PR MERGED') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="2.5" cy="2.5" r="1.5" />
        <circle cx="7.5" cy="7.5" r="1.5" />
        <path d="M2.5 4v1.5a2 2 0 0 0 2 2H7.5" />
      </svg>
    )
  }
  if (tier === 'major') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5,6.5 5,2.5 8.5,6.5" />
        <polyline points="1.5,8.5 5,4.5 8.5,8.5" />
      </svg>
    )
  }
  if (tier === 'prerelease') {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
        <polygon points="4.5,0.5 8.5,4.5 4.5,8.5 0.5,4.5" />
      </svg>
    )
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,6.5 5,2.5 8,6.5" />
      <line x1="5" y1="2.5" x2="5" y2="9" />
    </svg>
  )
}

export interface BannerCardProps {
  tag: string
  tier: BannerCardTier
  title: string
  descriptionPreview: string
  versionLabel: string
  ownerAvatarUrl: string
  repoFullName: string
  occurredAt: string
  onClick: () => void
}

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

export const BannerCard = memo(function BannerCard({
  tag, tier, title, descriptionPreview, versionLabel,
  ownerAvatarUrl, repoFullName, occurredAt, onClick,
}: BannerCardProps) {
  return (
    <div className={`banner-card banner-card--${tier}`} onClick={onClick}>
      <div className="banner-card__image">
        <DitherBackground
          avatarUrl={ownerAvatarUrl}
          fallbackGradient={tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
          staticFrame
        />
        <div className="banner-card__version-overlay">{versionLabel}</div>
      </div>
      <div className="banner-card__body">
        <span className={`banner-card__tag banner-card__tag--${tier}`}>
          <TagIcon tag={tag} tier={tier} />
          {tag}
        </span>
        <span className="banner-card__title">{title}</span>
        <p className="banner-card__desc">{descriptionPreview}</p>
        <div className="banner-card__meta">
          <div className="banner-card__meta-repo">
            <img src={ownerAvatarUrl} alt="" loading="lazy" decoding="async" />
            <strong>{repoFullName.split('/')[1] ?? repoFullName}</strong>
          </div>
          <span>·</span>
          <span>{relativeTime(occurredAt)}</span>
        </div>
      </div>
    </div>
  )
})
