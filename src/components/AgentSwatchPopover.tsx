import { useEffect, useRef, useState } from 'react'
import AgentEmojiPicker from './AgentEmojiPicker'
import AgentColorPicker, { type AgentColorPickerProps } from './AgentColorPicker'
import type { AgentRow } from '../types/agent'

type HarmonyMode = AgentColorPickerProps['harmony']

interface Props {
  agent: AgentRow
}

export default function AgentSwatchPopover({ agent }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'solid' | 'gradient'>(agent.color_end ? 'gradient' : 'solid')
  const [colorStart, setColorStart] = useState(agent.color_start ?? '#6366f1')
  const [colorEnd, setColorEnd] = useState<string | null>(agent.color_end)
  const [harmony, setHarmony] = useState<HarmonyMode>('manual')
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const background = colorEnd
    ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
    : colorStart

  return (
    <div className="agent-swatch-pop-wrap">
      <button
        type="button"
        className="agent-detail-swatch"
        aria-label="Edit appearance"
        style={{ background }}
        onClick={() => setOpen(o => !o)}
      >
        {agent.emoji ?? ''}
      </button>
      {open && (
        <div ref={popRef} className="agent-swatch-popover">
          <AgentColorPicker
            mode={mode}
            colorStart={colorStart}
            colorEnd={colorEnd}
            harmony={harmony}
            onChange={next => {
              setMode(next.mode)
              setColorStart(next.colorStart)
              setColorEnd(next.colorEnd)
              setHarmony(next.harmony)
              window.api.agents.update(agent.id, {
                color_start: next.colorStart,
                color_end: next.colorEnd,
              })
            }}
          />
          <AgentEmojiPicker
            value={agent.emoji}
            onChange={emoji => {
              window.api.agents.update(agent.id, { emoji })
            }}
          />
        </div>
      )}
    </div>
  )
}
