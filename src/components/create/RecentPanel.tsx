import { useNavigate } from 'react-router-dom'
import { getRecentVisits } from '../../lib/recentVisits'

export default function RecentPanel() {
  const navigate = useNavigate()
  const entries = getRecentVisits()

  return (
    <div className="projects-panel">
      <div className="projects-panel-header">RECENT</div>
      <div className="projects-panel-list">
        {entries.length === 0 ? (
          <div className="projects-panel-empty">No recent repos</div>
        ) : (
          entries.map(entry => (
            <button
              key={`${entry.owner}/${entry.name}`}
              type="button"
              className="projects-panel-item"
              onClick={() => navigate(entry.navigatePath)}
            >
              {entry.avatar_url ? (
                <img src={entry.avatar_url} alt="" className="projects-panel-avatar" />
              ) : (
                <span className="projects-panel-avatar-fallback">
                  {(entry.name[0] ?? '?').toUpperCase()}
                </span>
              )}
              <span className="projects-panel-name">{entry.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
