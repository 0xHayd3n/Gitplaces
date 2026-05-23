import { useEffect, useRef, useState } from 'react'
import { AGENT_EMOJIS } from './agentEmojiSet'

interface Props {
  value: string | null
  onChange: (emoji: string | null) => void
}

const DEFAULT_GLYPH = '🎭'

export default function AgentEmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const query = q.trim().toLowerCase()
  const filtered = query
    ? AGENT_EMOJIS.filter(e => e.keywords.some(k => k.includes(query)))
    : AGENT_EMOJIS

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label="Emoji"
        onClick={() => setOpen(o => !o)}
        className="agent-emoji-trigger"
      >
        {value ?? DEFAULT_GLYPH}
      </button>
      {open && (
        <div ref={popoverRef} className="agent-emoji-popover" role="dialog" aria-label="Pick emoji">
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="search emoji…"
            autoFocus
            className="agent-emoji-search"
          />
          <div className="agent-emoji-grid">
            {filtered.map(e => (
              <button
                key={e.emoji}
                type="button"
                data-emoji={e.emoji}
                onClick={() => { onChange(e.emoji); setOpen(false) }}
                className={`agent-emoji-cell${e.emoji === value ? ' selected' : ''}`}
              >
                {e.emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="agent-emoji-clear"
              data-emoji="__clear__"
            >
              ✕ clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
