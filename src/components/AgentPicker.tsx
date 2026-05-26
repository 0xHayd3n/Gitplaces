import { useEffect, useRef, useState } from 'react'

export interface AgentOption {
  id: string
  name: string
  model: string
  model_provider: string
  model_endpoint_id: string | null
}

interface Props {
  selectedAgentId: string | null
  onChange(agent: AgentOption | null): void
  disabled?: boolean
}

function BotIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zm-3.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm.5 4v-2h8v2H8z" />
    </svg>
  )
}

export function AgentPicker({ selectedAgentId, onChange, disabled }: Props) {
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.agents.getAll().then(({ agents: rows }) => {
      setAgents(rows.map(a => ({
        id: a.id,
        name: a.name,
        model: a.model,
        model_provider: a.model_provider,
        model_endpoint_id: a.model_endpoint_id,
      })))
    }).catch(err => {
      console.error('[agent-picker] failed to load agents:', err)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectedName = selectedAgentId
    ? (agents.find(a => a.id === selectedAgentId)?.name ?? 'Agent')
    : null

  return (
    <div ref={rootRef} className="ai-chat-picker">
      <button
        type="button"
        className={`ai-chat-picker-btn${selectedAgentId ? ' has-agent' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={selectedName ?? 'Quick chat — pick an agent'}
        aria-label={selectedName ?? 'Pick an agent'}
      >
        <BotIcon />
      </button>
      {open && (
        <div className="ai-chat-picker-menu" role="listbox">
          <button
            type="button"
            className={`ai-chat-picker-item${selectedAgentId === null ? ' selected' : ''}`}
            onClick={() => { onChange(null); setOpen(false) }}
          >
            Quick chat
          </button>
          {agents.map(a => (
            <button
              key={a.id}
              type="button"
              className={`ai-chat-picker-item${selectedAgentId === a.id ? ' selected' : ''}`}
              onClick={() => { onChange(a); setOpen(false) }}
            >
              {a.name}
            </button>
          ))}
          {agents.length === 0 && (
            <div className="ai-chat-picker-empty">No agents in library</div>
          )}
        </div>
      )}
    </div>
  )
}
