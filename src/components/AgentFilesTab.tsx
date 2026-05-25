import { useEffect, useState } from 'react'
import { FileText, Plus, Edit3, Trash2, Star } from 'lucide-react'
import type { AgentRow, AgentFile } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import AgentVariablePresetBar from './AgentVariablePresetBar'
import { detectVariables } from '../utils/agentVariables'

interface Props {
  agent: AgentRow
  activePresetId?: string | null
  onActivePresetChange?: (id: string | null) => void
}

const SCRIPT_EXTS = new Set(['sh', 'js', 'cjs', 'mjs', 'ts', 'py', 'rb', 'go'])
const MD_EXTS = new Set(['md', 'mdx', 'txt'])

type SectionKey = 'reference' | 'script' | 'other'

function classifyFile(filename: string): SectionKey {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (MD_EXTS.has(ext)) return 'reference'
  if (SCRIPT_EXTS.has(ext)) return 'script'
  return 'other'
}

export default function AgentFilesTab({ agent, activePresetId, onActivePresetChange }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.files.list(agent.id)
      if (cancelled) return
      setFiles(list)
      // Default to the primary file on first load.
      if (activeId === null) {
        const primary = list.find(f => f.sort_order === 0)
        setActiveId(primary?.id ?? list[0]?.id ?? null)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id])

  // Reset draft when the active file changes.
  useEffect(() => {
    if (!activeId) { setDraft(''); return }
    const f = files.find(x => x.id === activeId)
    setDraft(f?.content ?? '')
  }, [activeId, files])

  const activeFile = activeId ? files.find(f => f.id === activeId) ?? null : null
  const isPrimaryActive = activeFile?.sort_order === 0
  const activeFilename = activeFile?.filename ?? ''

  const presets = parseAgentPresets(agent.presets_json)
  const variables = isPrimaryActive ? detectVariables(draft) : []

  const onBlurSave = async (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (!activeFile) return
    const value = e.target.value
    await window.api.agents.files.update(agent.id, activeFile.id, { content: value })
  }

  const handleRename = async () => {
    if (!activeFile || activeFile.sort_order === 0) return
    const next = window.prompt('New filename:', activeFile.filename)
    if (!next || next === activeFile.filename) return
    try {
      await window.api.agents.files.update(agent.id, activeFile.id, { filename: next })
      setFiles(await window.api.agents.files.list(agent.id))
    } catch (err) {
      window.alert(`Rename failed: ${(err as Error).message}`)
    }
  }

  const handleDelete = async () => {
    if (!activeFile || activeFile.sort_order === 0) return
    if (!window.confirm('Delete this file?')) return
    await window.api.agents.files.delete(agent.id, activeFile.id)
    setFiles(await window.api.agents.files.list(agent.id))
    setActiveId(null)
  }

  const handleAdd = async () => {
    const filename = window.prompt('Filename for the new file:')
    if (!filename) return
    try {
      const created = await window.api.agents.files.create(agent.id, {
        filename,
        content: '',
        sortOrder: Math.max(0, ...files.map(x => x.sort_order)) + 1,
      })
      const next = await window.api.agents.files.list(agent.id)
      setFiles(next)
      setActiveId(created.id)
    } catch (err) {
      window.alert(`Add file failed: ${(err as Error).message}`)
    }
  }

  const primary = files.find(f => f.sort_order === 0) ?? null
  const siblings = files.filter(f => f.sort_order !== 0)
  const references = siblings.filter(f => classifyFile(f.filename) === 'reference')
  const scripts    = siblings.filter(f => classifyFile(f.filename) === 'script')
  const others     = siblings.filter(f => classifyFile(f.filename) === 'other')

  return (
    <div className="agent-detail-files">
      <aside className="agent-detail-files-list">
        {primary && (
          <>
            <div className="agent-detail-files-section">Persona</div>
            <FileItem
              file={primary}
              isPrimary
              active={activeId === primary.id}
              onSelect={() => setActiveId(primary.id)}
            />
          </>
        )}
        {references.length > 0 && <div className="agent-detail-files-section">References</div>}
        {references.map(f => (
          <FileItem key={f.id} file={f} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {scripts.length > 0 && <div className="agent-detail-files-section">Scripts</div>}
        {scripts.map(f => (
          <FileItem key={f.id} file={f} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {others.length > 0 && <div className="agent-detail-files-section">Other</div>}
        {others.map(f => (
          <FileItem key={f.id} file={f} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        <button
          type="button"
          className="agent-detail-files-add"
          onClick={handleAdd}
        >
          <Plus size={13} /> Add file
        </button>
      </aside>
      <section className="agent-detail-files-editor">
        <div className="agent-detail-files-header">
          <span className="agent-detail-files-name">
            {isPrimaryActive && <Star size={11} className="agent-file-primary-mark" />}
            {' '}{activeFilename || 'Select a file'}
          </span>
          {activeFile && !isPrimaryActive && (
            <div className="agent-detail-files-actions">
              <button
                type="button"
                className="agent-detail-files-btn"
                aria-label="Rename file"
                onClick={handleRename}
              >
                <Edit3 size={13} />
              </button>
              <button
                type="button"
                className="agent-detail-files-btn agent-detail-files-btn--danger"
                aria-label="Delete file"
                onClick={handleDelete}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {isPrimaryActive && presets.length > 0 && onActivePresetChange && (
          <AgentVariablePresetBar
            agent={agent}
            body={draft}
            variables={variables}
            activePresetId={activePresetId ?? null}
            onActivePresetChange={onActivePresetChange}
          />
        )}
        {activeFile ? (
          <textarea
            className="agent-detail-files-textarea"
            aria-label="File content"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={onBlurSave}
          />
        ) : (
          <p className="agent-detail-files-empty">Select a file to edit.</p>
        )}
      </section>
    </div>
  )
}

function FileItem({
  file, isPrimary = false, active, onSelect,
}: {
  file: AgentFile
  isPrimary?: boolean
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-file-id={file.id}
      className={
        'agent-detail-files-item'
        + (active ? ' agent-detail-files-item--active' : '')
        + (isPrimary ? ' agent-detail-files-item--main' : '')
      }
      onClick={onSelect}
    >
      {isPrimary && <Star size={11} className="agent-file-primary-mark" />}
      <FileText size={13} />
      {file.filename}
    </button>
  )
}
