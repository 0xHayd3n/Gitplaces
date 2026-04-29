import { RefreshCw } from 'lucide-react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useFeed } from '../hooks/useFeed'
import ActivityEvent from './ActivityEvent'
import './ActivityFeed.css'

export default function ActivityFeed() {
  const { user } = useGitHubAuth()
  const { events, loading, error, refresh } = useFeed()

  if (!user) {
    return (
      <div className="activity-feed activity-feed--empty">
        <p className="activity-feed-msg">Connect your GitHub account to see your activity</p>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <span className="activity-feed-title">Activity</span>
        <button className="activity-feed-refresh" onClick={refresh} title="Refresh" disabled={loading}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="activity-feed-body">
        {loading && events.length === 0 && (
          <div className="activity-feed-skeletons">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="activity-event-skeleton" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="activity-feed-msg activity-feed-msg--error">{error}</p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="activity-feed-msg">Nothing in your network yet</p>
        )}

        {events.map(event => (
          <ActivityEvent key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}
