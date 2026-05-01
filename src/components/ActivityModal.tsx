import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DitherBackground from './DitherBackground'
import { useSavedRepos } from '../contexts/SavedRepos'
import { classifyRelease } from '../utils/classifyRelease'
import { ReleaseModalContent } from './ReleaseModalContent'
import { PullRequestModalContent } from './PullRequestModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityModal.css'

interface Props {
  events: GitHubFeedEvent[]
  initialEventId: string
  onClose: () => void
}

interface DerivedHeader {
  tier: 'normal' | 'major' | 'prerelease' | 'pr'
  tag: string
  title: string
  prNumber: number | null
  bylineActor: string
  externalUrl: string
}

const POSTED_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'long', day: 'numeric',
})

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

// avatars.githubusercontent.com serves the image directly with CORS headers.
// github.com/<owner>.png is a 302 redirect that strips Access-Control-Allow-Origin,
// which taints the dither canvas and produces the blank fallback gradient.
function ownerAvatarUrl(owner: string, size: number): string {
  return `https://avatars.githubusercontent.com/${owner}?s=${size}`
}

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
      prNumber: null,
      bylineActor: event.actor.login,
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
    prNumber: pr.number,
    bylineActor: pr.user.login,
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

interface EntryProps {
  event: GitHubFeedEvent
  onClose: () => void
  eager?: boolean
}

function EntrySkeleton() {
  // Mirrors the real entry's vertical rhythm so the scroll height stays stable
  // when the skeleton swaps to real content.
  return (
    <div className="activity-modal__entry-skeleton" aria-hidden="true">
      <div className="activity-modal__skel activity-modal__skel--banner" />
      <div className="activity-modal__skel-header">
        <div className="activity-modal__skel activity-modal__skel--tag" />
        <div className="activity-modal__skel activity-modal__skel--title" />
        <div className="activity-modal__skel activity-modal__skel--byline" />
      </div>
      <div className="activity-modal__skel-body">
        <div className="activity-modal__skel activity-modal__skel--line" />
        <div className="activity-modal__skel activity-modal__skel--line activity-modal__skel--line-short" />
        <div className="activity-modal__skel activity-modal__skel--line" />
        <div className="activity-modal__skel activity-modal__skel--line activity-modal__skel--line-short" />
        <div className="activity-modal__skel activity-modal__skel--line" />
      </div>
    </div>
  )
}

function ActivityModalEntry({ event, onClose, eager = false }: EntryProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isSaved } = useSavedRepos()
  const [owner, name] = event.repo.full_name.split('/')

  const rootRef = useRef<HTMLDivElement>(null)
  const [shouldMount, setShouldMount] = useState(eager)

  // Render a skeleton until the entry is near the viewport; then swap in the
  // full content. This avoids the "half-loaded" look where the banner and
  // header pop in instantly while the body is still resolving, and keeps us
  // from firing every entry's getCompare / getRepo / link-preview fetches at
  // once when the modal opens. First entry mounts eagerly so the clicked
  // event is ready immediately.
  useEffect(() => {
    if (shouldMount) return
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShouldMount(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shouldMount])

  if (!shouldMount) {
    return (
      <div ref={rootRef} className="activity-modal__entry">
        <EntrySkeleton />
      </div>
    )
  }

  const header = deriveHeader(event)
  const saved = isSaved(owner, name)

  const handleOpenInLibrary = () => {
    onClose()
    navigate(`/library/repo/${owner}/${name}`)
  }

  // Pill click: stash this entry's id on the current /library history entry,
  // then navigate to the repo. When the user hits Back, ActivityFeed sees the
  // stashed id and re-opens the modal with this entry as the initial event,
  // restoring the scroll context the user was viewing.
  const handleOpenRepo = () => {
    navigate(location.pathname + location.search, {
      replace: true,
      state: { fromModalEventId: event.id },
    })
    onClose()
    navigate(`/library/repo/${owner}/${name}`)
  }

  return (
    <div ref={rootRef} className="activity-modal__entry">
      <div className="activity-modal__banner">
        <DitherBackground
          avatarUrl={ownerAvatarUrl(owner, 400)}
          fallbackGradient={header.tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
        />
      </div>

      <div className="activity-modal__header">
        <div className="activity-modal__tag-row">
          <span className={`activity-modal__tag ${tagModifier(header.tier)}`.trim()}>{header.tag}</span>
          {header.prNumber !== null && (
            <>
              <span className="dot">·</span>
              <span className="pr-number">#{header.prNumber}</span>
            </>
          )}
          <span className="dot">·</span>
          <span className="posted">Posted {POSTED_FMT.format(new Date(event.created_at))}</span>
        </div>
        <h1 className="activity-modal__title">{header.title}</h1>
        <button
          type="button"
          className="activity-modal__repo-pill"
          onClick={handleOpenRepo}
          title={`Open ${event.repo.full_name}`}
        >
          <img src={ownerAvatarUrl(owner, 40)} alt="" />
          <span>{name}</span>
        </button>
      </div>

      <div className="activity-modal__body">
        {event.type === 'ReleaseEvent'
          ? <ReleaseModalContent event={event} />
          : <PullRequestModalContent event={event} />}
      </div>

      <div className="activity-modal__entry-actions">
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
      </div>
    </div>
  )
}

export function ActivityModal({ events, initialEventId, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Restrict to the event types the modal can render. Watch/Fork events have
  // payloads deriveHeader and the body components don't understand and would
  // crash on. Filter first, then slice from the clicked event onward so older
  // Release/PR events appear below as the user scrolls.
  const supportedEvents = events.filter(
    e => e.type === 'ReleaseEvent' || e.type === 'PullRequestEvent',
  )
  const startIndex = supportedEvents.findIndex(e => e.id === initialEventId)
  const visibleEvents = startIndex >= 0 ? supportedEvents.slice(startIndex) : []

  return (
    <div className="activity-modal-overlay" onClick={onClose}>
      <div className="activity-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="activity-modal__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <div className="activity-modal__scroll">
          {visibleEvents.map((event, index) => (
            <ActivityModalEntry
              key={event.id}
              event={event}
              onClose={onClose}
              eager={index === 0}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
