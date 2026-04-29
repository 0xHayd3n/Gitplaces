import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useRepoData } from '../hooks/useForkData'
import { relativeTime } from '../utils/relativeTime'
import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'
import './StarEventCard.css'

interface Props {
  event: GitHubFeedEvent
}

export function StarEventCard({ event }: Props) {
  const fullName = event.repo.full_name
  const { repo, loading } = useRepoData(fullName)
  const [owner, name] = fullName.split('/')

  return (
    <div className="star-event">
      <div className="star-event__header">
        <img
          className="star-event__avatar"
          src={event.actor.avatar_url}
          alt={event.actor.login}
        />
        <span>
          <strong>{event.actor.login}</strong> starred a repository
        </span>
        <span className="star-event__time">{relativeTime(event.created_at)}</span>
      </div>
      <div className="star-event__body">
        {loading ? (
          <ForkRepoCardSkeleton />
        ) : (
          <ForkRepoCard
            owner={repo?.owner ?? owner}
            name={repo?.name ?? name}
            avatarUrl={repo?.avatarUrl ?? `https://github.com/${owner}.png?size=200`}
            description={repo?.description ?? null}
            language={repo?.language ?? null}
            stars={repo?.stars ?? null}
            forks={repo?.forks ?? null}
            isFork={false}
          />
        )}
      </div>
    </div>
  )
}
