import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentRow } from '../types/agent'
import './AgentsLanding.css'

const RECENT_CAP = 10
const PINNED_COLS = 3

export default function AgentsLanding() {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const fetchAll = async () => {
    const { agents: list } = await window.api.agents.getAll()
    setAgents(list)
    setLoaded(true)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { agents: list } = await window.api.agents.getAll()
      if (cancelled) return
      setAgents(list)
      setLoaded(true)
    })()
    const cb = () => { fetchAll().catch(() => {}) }
    window.api.agents.onChanged(cb)
    return () => {
      cancelled = true
      window.api.agents.offChanged(cb)
    }
  }, [])

  const pinned = useMemo(
    () => agents
      .filter(a => a.pinned === 1)
      .sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? '')),
    [agents],
  )

  const recent = useMemo(
    () => agents
      .filter(a => a.last_used_at !== null)
      .sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''))
      .slice(0, RECENT_CAP),
    [agents],
  )

  if (!loaded) {
    return <div className="agents-landing-loading">Loading…</div>
  }

  const showOnboarding = pinned.length === 0 && recent.length === 0

  return (
    <div className="agents-landing">
      <header className="agents-landing-header">
        <div className="agents-landing-eyebrow">AGENTS</div>
        <h1 className="agents-landing-title">Your prompt library</h1>
        <p className="agents-landing-sub">
          {agents.length} agent{agents.length === 1 ? '' : 's'} · Click any in the sidebar, or copy a handle.
        </p>
      </header>

      {showOnboarding ? (
        <div className="agents-landing-onboarding">
          <h2>Start your library</h2>
          <p>
            Each agent is a reusable system prompt. Give it a <code>@handle</code>, add{' '}
            <code>{'{{variables}}'}</code>, save named presets, and the Copy button drops
            it into any AI tool with the right framing.
          </p>
          <Link to="/library/agent/new" className="agents-landing-cta">+ New agent</Link>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="agents-landing-section">
              <h2>Pinned</h2>
              <div
                className="agents-landing-pinned-grid"
                style={{ gridTemplateColumns: `repeat(${PINNED_COLS}, minmax(0, 1fr))` }}
              >
                {pinned.map(a => (
                  <PinnedCard key={a.id} agent={a} />
                ))}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section className="agents-landing-section">
              <h2>Recent</h2>
              <ul className="agents-landing-recent">
                {recent.map(a => (
                  <RecentRow key={a.id} agent={a} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function PinnedCard({ agent }: { agent: AgentRow }) {
  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }
  const snippet = firstLine(agent.body)
  return (
    <Link
      to={`/library/agent/${agent.id}`}
      className="agents-landing-pinned-card"
      data-testid="agents-landing-pinned-card"
    >
      <div className="agents-landing-pinned-swatch" style={swatchStyle}>
        {agent.emoji ?? ''}
      </div>
      <div className="agents-landing-pinned-handle">@{agent.handle}</div>
      <div className="agents-landing-pinned-name">{agent.name}</div>
      <div className="agents-landing-pinned-snippet">{snippet}</div>
    </Link>
  )
}

function RecentRow({ agent }: { agent: AgentRow }) {
  const swatchStyle: React.CSSProperties = {
    background: agent.color_end
      ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
      : (agent.color_start ?? '#888'),
  }
  return (
    <li className="agents-landing-recent-row" data-testid="agents-landing-recent-row">
      <Link to={`/library/agent/${agent.id}`} className="agents-landing-recent-link">
        <div className="agents-landing-recent-swatch" style={swatchStyle}>
          {agent.emoji ?? ''}
        </div>
        <span className="agents-landing-recent-handle">@{agent.handle}</span>
        <span className="agents-landing-recent-name">{agent.name}</span>
        <span className="agents-landing-recent-time">{relativeTime(agent.last_used_at)}</span>
      </Link>
    </li>
  )
}

function firstLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim()
    if (t.length === 0) continue
    if (t.startsWith('#')) continue
    return t.length > 80 ? t.slice(0, 79) + '…' : t
  }
  return ''
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
