import { useNavigate } from 'react-router-dom'
import { useSavedRepos } from '../contexts/SavedRepos'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityEvent.css'
import { ForkEventCard } from './ForkEventCard'

interface Props {
  event: GitHubFeedEvent
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function buildDescription(event: GitHubFeedEvent): { parts: Array<{ text: string; bold: boolean }> } {
  const actor = event.actor.login
  const repoFull = event.repo.full_name

  switch (event.type) {
    case 'WatchEvent':
      return { parts: [
        { text: actor, bold: true },
        { text: ' starred ', bold: false },
        { text: repoFull, bold: true },
      ]}
    case 'ForkEvent': {
      const forkee = (event.payload as { forkee: { full_name: string } }).forkee.full_name
      return { parts: [
        { text: actor, bold: true },
        { text: ' forked ', bold: false },
        { text: repoFull, bold: true },
        { text: ' → ', bold: false },
        { text: forkee, bold: true },
      ]}
    }
    case 'ReleaseEvent': {
      const tag = (event.payload as { release: { tag_name: string } }).release.tag_name
      return { parts: [
        { text: actor, bold: true },
        { text: ' released ', bold: false },
        { text: tag, bold: true },
        { text: ' on ', bold: false },
        { text: repoFull, bold: true },
      ]}
    }
    case 'PullRequestEvent':
      return { parts: [
        { text: actor, bold: true },
        { text: ' merged a PR into ', bold: false },
        { text: repoFull, bold: true },
      ]}
  }
}

export default function ActivityEvent({ event }: Props) {
  const navigate = useNavigate()
  const { isSaved } = useSavedRepos()

  if (event.type === 'ForkEvent') {
    return <ForkEventCard event={event} />
  }

  const [owner, name] = event.repo.full_name.split('/')
  const saved = isSaved(owner, name)

  const { parts } = buildDescription(event)

  const handleRepoClick = () => {
    if (saved) navigate(`/library/repo/${owner}/${name}`)
  }

  return (
    <div className="activity-event">
      <img
        className="activity-event-avatar"
        src={event.actor.avatar_url}
        alt={event.actor.login}
      />
      <p className="activity-event-desc">
        {parts.map((part, i) => {
          const isRepo = part.text === event.repo.full_name
          if (isRepo && saved) {
            return (
              <button key={i} className="activity-event-repo-link" onClick={handleRepoClick}>
                {part.text}
              </button>
            )
          }
          return part.bold
            ? <strong key={i}>{part.text}</strong>
            : <span key={i}>{part.text}</span>
        })}
      </p>
      <span className="activity-event-time">{relativeTime(event.created_at)}</span>
    </div>
  )
}
