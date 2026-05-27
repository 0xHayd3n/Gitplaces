import { useNavigate } from 'react-router-dom'
import type { AgentRow } from '../types/agent'
import './AgentCard.css'

interface AgentCardProps {
  agent: AgentRow
  focused?: boolean
}

export default function AgentCard({ agent, focused }: AgentCardProps) {
  const navigate = useNavigate()

  const background = agent.color_end
    ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
    : (agent.color_start ?? '#888')

  return (
    <button
      type="button"
      className={`agent-card${focused ? ' kb-focused' : ''}${agent.pinned === 1 ? ' agent-card-pinned' : ''}`}
      onClick={() => navigate(`/library/agent/${agent.id}`)}
      aria-label={agent.name}
    >
      <div
        className="agent-card-swatch"
        data-testid="agent-card-swatch"
        style={{ background }}
      >
        <span className="agent-card-swatch-emoji">{agent.emoji ?? ''}</span>
      </div>
      <div className="agent-card-body">
        <div className="agent-card-title-block">
          <div className="agent-card-title">{agent.name}</div>
          <span className="agent-card-handle">@{agent.handle}</span>
        </div>
        <div className="agent-card-pill-row">
          {agent.is_subagent === 1 && (
            <span className="agent-card-pill">Subagent</span>
          )}
          {agent.is_slash_command === 1 && (
            <span className="agent-card-pill">Slash Command</span>
          )}
        </div>
        {agent.description && (
          <p className="agent-card-description">{agent.description}</p>
        )}
      </div>
    </button>
  )
}
