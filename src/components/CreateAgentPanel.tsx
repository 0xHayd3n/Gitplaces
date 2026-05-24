import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { slugifyName, dedupeHandle, isValidHandle } from '../utils/agentSlug'
import { hashHandleToColor, type HarmonyMode } from '../utils/colorHarmony'
import { useToast } from '../contexts/Toast'
import AgentEmojiPicker from './AgentEmojiPicker'
import AgentColorPicker from './AgentColorPicker'
import type { AgentRow, AgentFolderRow } from '../types/agent'

export default function CreateAgentPanel() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [takenHandles, setTakenHandles] = useState<string[]>([])

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)

  const [mode, setMode] = useState<'solid' | 'gradient'>('solid')
  const [colorStart, setColorStart] = useState('#6366f1')
  const [colorEnd, setColorEnd] = useState<string | null>(null)
  const [harmony, setHarmony] = useState<HarmonyMode>('manual')
  const [emoji, setEmoji] = useState<string | null>(null)

  const [folderId, setFolderId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { folders, agents } = await window.api.agents.getAll()
      if (cancelled) return
      setFolders(folders)
      setTakenHandles(agents.map(a => a.handle).filter(Boolean))
    })()
    return () => { cancelled = true }
  }, [])

  // Auto-fill handle from name (only if user hasn't manually edited)
  useEffect(() => {
    if (handleEdited) return
    if (name.trim().length === 0) {
      setHandle('')
      return
    }
    const slug = slugifyName(name)
    const deduped = dedupeHandle(slug, takenHandles)
    setHandle(`@${deduped}`)
  }, [name, handleEdited, takenHandles])

  // Default color follows the handle until the user touches the picker
  const defaultColorStart = useMemo(
    () => handle.length > 1 ? hashHandleToColor(handle.replace(/^@/, '')) : '#6366f1',
    [handle],
  )
  const [colorTouched, setColorTouched] = useState(false)
  useEffect(() => {
    if (colorTouched) return
    setColorStart(defaultColorStart)
  }, [defaultColorStart, colorTouched])

  const cleanHandle = handle.replace(/^@/, '')
  const handleIsValid = isValidHandle(cleanHandle) && !takenHandles.includes(cleanHandle)
  const canSubmit = !submitting && name.trim().length > 0 && handleIsValid

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const row: AgentRow = await window.api.agents.create({
        name: name.trim(),
        body: '',
        folderId,
        handle: cleanHandle,
        colorStart,
        colorEnd,
        emoji,
      })
      navigate(`/library/agent/${row.id}`)
    } catch (e) {
      setSubmitting(false)
      toast(
        e instanceof Error && e.message.includes('Handle')
          ? `Handle already in use: @${cleanHandle}`
          : 'Failed to create agent',
        'error',
      )
    }
  }

  return (
    <div className="create-agent-panel">
      <header className="create-agent-header">
        <h2>New agent</h2>
      </header>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Identity</div>

        <div className="create-agent-field">
          <label htmlFor="cap-name" className="create-agent-label">Name</label>
          <input
            id="cap-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="create-agent-field">
          <label htmlFor="cap-handle" className="create-agent-label">Handle</label>
          <input
            id="cap-handle"
            type="text"
            value={handle}
            onChange={e => { setHandle(e.target.value); setHandleEdited(true) }}
          />
          <div className="create-agent-hint">
            Auto from name (space → dash, lowercase). Must be unique.
          </div>
        </div>
      </section>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Appearance</div>
        <div className="create-agent-custom">
          <div onMouseDown={() => setColorTouched(true)}>
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
              }}
            />
          </div>
          <div className="create-agent-emoji-block">
            <AgentEmojiPicker value={emoji} onChange={setEmoji} />
          </div>
        </div>
      </section>

      <section className="create-agent-section">
        <div className="create-agent-section-label">Organize</div>
        <div className="create-agent-field">
          <label htmlFor="cap-folder" className="create-agent-label">Folder</label>
          <select id="cap-folder" value={folderId ?? ''} onChange={e => setFolderId(e.target.value || null)}>
            <option value="">Unfiled</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </section>

      <div className="create-agent-preview">
        <div
          className="create-agent-preview-swatch"
          style={{
            background: mode === 'gradient' && colorEnd
              ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
              : colorStart,
          }}
        >
          {emoji ?? '🎭'}
        </div>
        <div>
          <div className="create-agent-preview-name">{name || 'New agent'}</div>
          <div className="create-agent-preview-handle">{handle || '@'}</div>
        </div>
      </div>

      <footer className="create-agent-footer">
        <button type="button" onClick={() => navigate('/library')}>Cancel</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="create-agent-submit"
        >
          Create agent
        </button>
      </footer>
    </div>
  )
}
