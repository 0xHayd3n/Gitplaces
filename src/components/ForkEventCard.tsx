import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useForkData } from '../hooks/useForkData'
import type { ForkRepoData } from '../hooks/useForkData'
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

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript:  '#3178c6',
  JavaScript:  '#f1e05a',
  Python:      '#3572A5',
  Rust:        '#dea584',
  Go:          '#00ADD8',
  Java:        '#b07219',
  'C++':       '#f34b7d',
  C:           '#555555',
  'C#':        '#178600',
  Ruby:        '#701516',
  PHP:         '#4F5D95',
  Swift:       '#F05138',
  Kotlin:      '#A97BFF',
  Shell:       '#89e051',
  HTML:        '#e34c26',
  CSS:         '#563d7c',
}

const LANG_COLOR_FALLBACK = '#3fb950'

function langColor(language: string | null): string {
  return (language && LANGUAGE_COLORS[language]) || LANG_COLOR_FALLBACK
}

interface ForkMiniCardProps {
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number | null
  forks: number | null
  isFork: boolean
}

function ForkMiniCard({ owner, name, description, language, stars, forks, isFork }: ForkMiniCardProps) {
  return (
    <a
      className={`fork-mini-card${isFork ? ' fork-mini-card--fork' : ''}`}
      href={`https://github.com/${owner}/${name}`}
      target="_blank"
      rel="noreferrer"
    >
      <div className="fork-mini-card__top">
        <span className="fork-mini-card__owner">{owner}</span>
        {isFork && <span className="fork-mini-card__badge">fork</span>}
      </div>
      <div className="fork-mini-card__name">{name}</div>
      {description && <div className="fork-mini-card__desc">{description}</div>}
      {(language || (!isFork && stars !== null)) && (
        <div className="fork-mini-card__meta">
          {language && (
            <span className="fork-mini-card__lang">
              <span className="fork-mini-card__lang-dot" style={{ background: langColor(language) }} />
              {language}
            </span>
          )}
          {!isFork && stars !== null && (
            <span>★ {stars.toLocaleString()}</span>
          )}
          {!isFork && forks !== null && (
            <span>⑂ {forks.toLocaleString()}</span>
          )}
        </div>
      )}
    </a>
  )
}

function ForkMiniCardSkeleton() {
  return (
    <div className="fork-mini-card fork-mini-card--skeleton">
      <div className="fork-skeleton fork-skeleton--owner" />
      <div className="fork-skeleton fork-skeleton--name" />
      <div className="fork-skeleton fork-skeleton--desc-full" />
      <div className="fork-skeleton fork-skeleton--desc-short" />
      <div className="fork-skeleton fork-skeleton--meta" />
    </div>
  )
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
            <ForkMiniCardSkeleton />
            <span className="fork-event__arrow">→</span>
            <ForkMiniCardSkeleton />
          </>
        ) : (
          <>
            <ForkMiniCard
              owner={original?.owner ?? originalOwner}
              name={original?.name ?? originalName}
              description={original?.description ?? null}
              language={original?.language ?? null}
              stars={original?.stars ?? null}
              forks={original?.forks ?? null}
              isFork={false}
            />
            <span className="fork-event__arrow">→</span>
            <ForkMiniCard
              owner={fork?.owner ?? forkOwner}
              name={fork?.name ?? forkName}
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
