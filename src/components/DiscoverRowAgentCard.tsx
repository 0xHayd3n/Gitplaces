import type { AgentRow } from '../types/agent'

export interface DiscoverRowAgentCardProps {
  agent: AgentRow
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
}

export default function DiscoverRowAgentCard({
  agent, posIndex, columns, visible, onNavigate,
}: DiscoverRowAgentCardProps) {
  const isPeek = posIndex < 0 || posIndex >= visible
  const isActive = posIndex === 0
  const GAP = 16
  const cardWidth = `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`
  const cardLeft = posIndex === 0
    ? '0px'
    : `calc(${posIndex} * (100% + ${GAP}px))`

  const background = agent.color_end
    ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
    : (agent.color_start ?? '#888')

  return (
    <button
      key={agent.id}
      className={`discover-row-card${isPeek ? ' discover-row-card--peek' : isActive ? ' discover-row-card--p0' : ''}${agent.pinned === 1 ? ' discover-row-card--starred' : ''}`}
      style={{ width: cardWidth, transform: `translateX(${cardLeft})` } as React.CSSProperties}
      onClick={!isPeek ? () => onNavigate(`/library/agent/${agent.id}`) : undefined}
      aria-label={agent.name}
      tabIndex={isPeek ? -1 : undefined}
      aria-hidden={isPeek}
    >
      <div className="repo-card-image" style={{ background }}>
        <span style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
        }}>{agent.emoji ?? ''}</span>
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{agent.name}</div>
          <span className="repo-card-author">@{agent.handle}</span>
        </div>
        <div className="repo-card-pill-row">
          {agent.is_subagent === 1 && <span className="repo-card-pill">Subagent</span>}
          {agent.is_slash_command === 1 && <span className="repo-card-pill">Slash Command</span>}
        </div>
        {agent.description && (
          <p className="repo-card-description">{agent.description}</p>
        )}
      </div>
    </button>
  )
}
