import { useEffect, useRef, useState } from 'react'
import AgentEmojiPicker from './AgentEmojiPicker'
import './FolderKebabMenu.css'

export const FOLDER_PALETTE: readonly { name: string; hex: string }[] = [
  { name: 'Slate',  hex: '#64748b' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Amber',  hex: '#f59e0b' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Pink',   hex: '#ec4899' },
]

interface Props {
  x: number
  y: number
  folderId: string
  currentColor: string | null
  currentEmoji: string | null
  onClose:  () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}

export default function FolderKebabMenu({
  x, y, folderId, currentColor, currentEmoji,
  onClose, onRename, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [showColors, setShowColors] = useState(false)
  const [showEmoji,  setShowEmoji]  = useState(false)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown',  key)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown',  key)
    }
  }, [onClose])

  const pickColor = async (hex: string | null) => {
    await window.api.agents.updateFolder(folderId, { colorStart: hex })
    onClose()
  }

  const pickEmoji = async (emoji: string | null) => {
    await window.api.agents.updateFolder(folderId, { emoji })
    setShowEmoji(false)
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed', top: y, left: x, zIndex: 9999,
  }

  return (
    <div ref={ref} role="menu" className="folder-kebab-menu" style={style}>
      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => { onRename(folderId); onClose() }}
      >Rename</button>

      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => setShowColors(v => !v)}
      >
        Color
        {currentColor && (
          <span className="folder-kebab-accessory-dot" style={{ background: currentColor }} />
        )}
      </button>
      {showColors && (
        <div className="folder-kebab-color-row" data-testid="folder-color-swatches">
          {FOLDER_PALETTE.map(c => (
            <button
              key={c.hex}
              type="button"
              className="folder-kebab-swatch"
              aria-label={c.name}
              data-active={currentColor === c.hex ? 'true' : undefined}
              style={{ background: c.hex }}
              onClick={() => pickColor(c.hex)}
            />
          ))}
          <button
            type="button"
            className="folder-kebab-swatch folder-kebab-swatch--none"
            aria-label="None"
            onClick={() => pickColor(null)}
          />
        </div>
      )}

      <button
        role="menuitem" type="button" className="folder-kebab-item"
        onClick={() => setShowEmoji(v => !v)}
      >
        Emoji
        {currentEmoji && (
          <span className="folder-kebab-accessory-emoji">{currentEmoji}</span>
        )}
      </button>
      {showEmoji && (
        <div className="folder-kebab-emoji-host">
          <AgentEmojiPicker value={currentEmoji} onChange={pickEmoji} />
        </div>
      )}

      <button
        role="menuitem" type="button" className="folder-kebab-item folder-kebab-item--danger"
        onClick={() => { onDelete(folderId); onClose() }}
      >Delete folder</button>
    </div>
  )
}
