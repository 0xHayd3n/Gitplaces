import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useForkData } from '../hooks/useForkData'
import { relativeTime } from '../utils/relativeTime'
import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'
import './ForkEventCard.css'

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
              avatarUrl={original?.avatarUrl ?? `https://github.com/${originalOwner}.png?size=200`}
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
              avatarUrl={fork?.avatarUrl ?? `https://github.com/${forkOwner}.png?size=200`}
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
