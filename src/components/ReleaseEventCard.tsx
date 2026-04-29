import { useState, lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { relativeTime } from '../utils/relativeTime'
import { parseCompareUrl, stripCompareLine } from '../utils/parseCompareUrl'
import { CompareSummary } from './CompareSummary'
import './ReleaseEventCard.css'

// Lazy-load the full readme renderer so feed cards inherit the same markdown
// styling as RepoDetail/FileContentPanel (tables, callouts, code blocks, etc.).
const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

const COLLAPSED_CHAR_LIMIT = 400

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
  }
}

interface Props {
  event: GitHubFeedEvent
}

export function ReleaseEventCard({ event }: Props) {
  const [expanded, setExpanded] = useState(false)
  const release = (event.payload as ReleasePayload).release
  const tag = release.tag_name
  const releaseName = release.name?.trim() || null
  const rawBody = release.body?.trim() || ''

  const title = releaseName && releaseName !== tag
    ? `${tag} — ${releaseName}`
    : tag

  // Parse the auto-generated "Full Changelog" line out of the body so we can
  // render a structured before/after summary in its place. Falls back gracefully
  // (no summary, full body) when no compare URL is found.
  const compare = parseCompareUrl(rawBody)
  const body = compare ? stripCompareLine(rawBody) : rawBody

  const isLong = body.length > COLLAPSED_CHAR_LIMIT
  const truncated = (() => {
    if (!isLong) return body
    const slice = body.slice(0, COLLAPSED_CHAR_LIMIT)
    const lastNewline = slice.lastIndexOf('\n')
    return (lastNewline > 0 ? slice.slice(0, lastNewline) : slice) + '…'
  })()
  const visibleBody = expanded ? body : truncated

  const repoUrl = `https://github.com/${event.repo.full_name}`
  const releaseUrl = `${repoUrl}/releases/tag/${encodeURIComponent(tag)}`

  return (
    <div className="release-event">
      <div className="release-event__header">
        <img
          className="release-event__avatar"
          src={event.actor.avatar_url}
          alt={event.actor.login}
        />
        <span>
          <strong>{event.actor.login}</strong> released{' '}
          <a href={releaseUrl} target="_blank" rel="noreferrer" className="release-event__tag">
            {tag}
          </a>
          {' '}on{' '}
          <a href={repoUrl} target="_blank" rel="noreferrer" className="release-event__repo">
            {event.repo.full_name}
          </a>
        </span>
        <span className="release-event__time">{relativeTime(event.created_at)}</span>
      </div>

      {(body || compare) && (
        <div className="release-event__notes">
          <a className="release-event__title" href={releaseUrl} target="_blank" rel="noreferrer">
            {title}
          </a>
          {body && (
            <div className="release-event__body">
              <Suspense fallback={<div className="release-event__body-fallback" />}>
                <ReadmeRenderer
                  content={visibleBody}
                  repoOwner={event.repo.full_name.split('/')[0] ?? ''}
                  repoName={event.repo.full_name.split('/')[1] ?? ''}
                />
              </Suspense>
            </div>
          )}
          {isLong && (
            <button
              type="button"
              className="release-event__toggle"
              onClick={() => setExpanded(prev => !prev)}
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {compare && (
        <CompareSummary
          owner={compare.owner}
          repo={compare.repo}
          base={compare.base}
          head={compare.head}
        />
      )}
    </div>
  )
}
