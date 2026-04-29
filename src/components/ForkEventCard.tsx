import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useForkData } from '../hooks/useForkData'
import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'
import './ForkEventCard.css'

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

interface Props {
  event: GitHubFeedEvent
}

export function ForkEventCard({ event }: Props) {
  const originalFullName = event.repo.full_name
  const forkFullName = (event.payload as { forkee: { full_name: string } }).forkee.full_name

  const { original, fork, loading } = useForkData(originalFullName, forkFullName)

  const [originalOwner, originalName] = originalFullName.split('/')
  const [forkOwner, forkName] = forkFullName.split('/')

  const arrow = (
    <div className="fork-event__arrow-col">
      <div className="fork-event__arrow-circle">→</div>
    </div>
  )

  return (
    <div className="fork-event">
      <div className="fork-event__header">
        <img
          className="fork-event__avatar"
          src={event.actor.avatar_url}
          alt={event.actor.login}
        />
        <span>
          <strong>{event.actor.login}</strong> forked a repository
        </span>
        <span className="fork-event__time">{relativeTime(event.created_at)}</span>
      </div>
      <div className="fork-event__body">
        {loading ? (
          <>
            <ForkRepoCardSkeleton />
            {arrow}
            <ForkRepoCardSkeleton />
          </>
        ) : (
          <>
            <ForkRepoCard
              owner={original?.owner ?? originalOwner}
              name={original?.name ?? originalName}
              avatarUrl={`https://github.com/${original?.owner ?? originalOwner}.png?size=40`}
              description={original?.description ?? null}
              language={original?.language ?? null}
              stars={original?.stars ?? null}
              forks={original?.forks ?? null}
              isFork={false}
            />
            {arrow}
            <ForkRepoCard
              owner={fork?.owner ?? forkOwner}
              name={fork?.name ?? forkName}
              avatarUrl={`https://github.com/${fork?.owner ?? forkOwner}.png?size=40`}
              description={fork?.description ?? null}
              language={fork?.language ?? null}
              stars={fork?.stars ?? null}
              forks={fork?.forks ?? null}
              isFork={true}
            />
          </>
        )}
      </div>
    </div>
  )
}
