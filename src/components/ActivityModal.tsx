import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DitherBackground from './DitherBackground'
import { useSavedRepos } from '../contexts/SavedRepos'
import { classifyRelease } from '../utils/classifyRelease'
import { ReleaseModalContent } from './ReleaseModalContent'
import { PullRequestModalContent } from './PullRequestModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityModal.css'

interface Props {
  event: GitHubFeedEvent
  onClose: () => void
}

interface DerivedHeader {
  tier: 'normal' | 'major' | 'prerelease' | 'pr'
  tag: string
  title: string
  versionLabel: string
  bylineActor: string
  bylineActorAvatar: string
  externalUrl: string
}

const POSTED_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'long', day: 'numeric',
})

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

function deriveHeader(event: GitHubFeedEvent): DerivedHeader {
  const [owner, name] = event.repo.full_name.split('/')

  if (event.type === 'ReleaseEvent') {
    const release = (event.payload as unknown as {
      release: { tag_name: string; name?: string | null; prerelease?: boolean | null }
    }).release
    const tier = classifyRelease({
      tagName: release.tag_name,
      prereleaseFlag: release.prerelease === true,
    })
    const tag = tier === 'major' ? 'MAJOR UPDATE'
      : tier === 'prerelease' ? 'PRE-RELEASE'
      : 'UPDATE'
    const titleSuffix = release.name && release.name.trim() !== release.tag_name
      ? ` — ${release.name.trim()}`
      : ''
    return {
      tier,
      tag,
      title: `${release.tag_name}${titleSuffix}`,
      versionLabel: release.tag_name,
      bylineActor: event.actor.login,
      bylineActorAvatar: event.actor.avatar_url,
      externalUrl: `https://github.com/${owner}/${name}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    }
  }

  // PullRequestEvent
  const pr = (event.payload as unknown as {
    pull_request: { number: number; title: string; user: { login: string; avatar_url: string } }
  }).pull_request
  return {
    tier: 'pr',
    tag: 'PR MERGED',
    title: pr.title,
    versionLabel: `#${pr.number}`,
    bylineActor: pr.user.login,
    bylineActorAvatar: pr.user.avatar_url,
    externalUrl: `https://github.com/${owner}/${name}/pull/${pr.number}`,
  }
}

function tagModifier(tier: DerivedHeader['tier']): string {
  if (tier === 'major') return 'activity-modal__tag--major'
  if (tier === 'prerelease') return 'activity-modal__tag--prerelease'
  return ''
}

function openExternal(url: string) {
  void window.api.openExternal(url)
}

export function ActivityModal({ event, onClose }: Props) {
  const navigate = useNavigate()
  const { isSaved } = useSavedRepos()
  const header = useMemo(() => deriveHeader(event), [event])
  const [owner, name] = event.repo.full_name.split('/')
  const saved = isSaved(owner, name)
  const verb = event.type === 'ReleaseEvent' ? 'released by' : 'merged by'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleOpenInLibrary = () => {
    onClose()
    navigate(`/library/repo/${owner}/${name}`)
  }

  return (
    <div className="activity-modal-overlay" onClick={onClose}>
      <div className="activity-modal" onClick={(e) => e.stopPropagation()}>
        <div className="activity-modal__banner">
          <DitherBackground
            avatarUrl={`https://github.com/${owner}.png?size=400`}
            fallbackGradient={header.tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
          />
          <div className="activity-modal__banner-version">{header.versionLabel}</div>
          <button
            className="activity-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="activity-modal__header">
          <div className="activity-modal__tag-row">
            <span className={tagModifier(header.tier)}>{header.tag}</span>
            <span className="dot">·</span>
            <span className="posted">Posted {POSTED_FMT.format(new Date(event.created_at))}</span>
          </div>
          <h1 className="activity-modal__title">{header.title}</h1>
          <div className="activity-modal__byline">
            <img src={`https://github.com/${owner}.png?size=40`} alt="" />
            <span><strong>{event.repo.full_name}</strong> · {verb} {header.bylineActor}</span>
          </div>
        </div>

        <div className="activity-modal__body">
          {event.type === 'ReleaseEvent'
            ? <ReleaseModalContent event={event} />
            : <PullRequestModalContent event={event} />}
        </div>

        <div className="activity-modal__footer">
          <button
            className="activity-modal__btn activity-modal__btn--primary"
            onClick={handleOpenInLibrary}
            disabled={!saved}
            title={saved ? '' : 'Save this repo to your library first'}
          >
            Open in Library
          </button>
          <button
            className="activity-modal__btn activity-modal__btn--secondary"
            onClick={() => openExternal(header.externalUrl)}
          >
            View on GitHub
          </button>
          <div className="spacer" />
          <button
            className="activity-modal__btn activity-modal__btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
