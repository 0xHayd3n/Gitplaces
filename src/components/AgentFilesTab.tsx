import { useEffect, useState } from 'react'
import { FileText, Plus, Edit3, Trash2 } from 'lucide-react'
import type { AgentRow, AgentFile } from '../types/agent'

interface Props {
  agent: AgentRow
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

export default function AgentFilesTab({ agent }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([])
  const [activeId, setActiveId] = useState<string>('main')
  const [draft, setDraft] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.files.list(agent.id)
      if (!cancelled) setFiles(list)
    })()
    return () => { cancelled = true }
  }, [agent.id])

  // Reset draft when the active file changes
  useEffect(() => {
    if (activeId === 'main') setDraft(agent.body)
    else {
      const f = files.find(x => x.id === activeId)
      setDraft(f?.content ?? '')
    }
  }, [activeId, agent.body, files])

  const onBlurSave = async (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Read the latest value directly from the DOM so we never write a stale
    // closure value (the draft state may not have propagated yet when blur
    // fires immediately after a change event in tests).
    const value = e.target.value
    if (activeId === 'main') {
      await window.api.agents.update(agent.id, { body: value })
    } else {
      await window.api.agents.files.update(agent.id, activeId, { content: value })
    }
  }

  const references = files.filter(f => classifyFile(f.filename) === 'reference')
  const scripts = files.filter(f => classifyFile(f.filename) === 'script')
  const others = files.filter(f => classifyFile(f.filename) === 'other')

  const activeFilename = activeId === 'main'
    ? 'SKILL.md'
    : (files.find(f => f.id === activeId)?.filename ?? '')

  const handleRename = async () => {
    const f = files.find(x => x.id === activeId)
    if (!f) return
    const next = window.prompt('New filename:', f.filename)
    if (!next || next === f.filename) return
    try {
      await window.api.agents.files.update(agent.id, activeId, { filename: next })
      setFiles(await window.api.agents.files.list(agent.id))
    } catch (err) {
      window.alert(`Rename failed: ${(err as Error).message}`)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this file?')) return
    await window.api.agents.files.delete(agent.id, activeId)
    setFiles(await window.api.agents.files.list(agent.id))
    setActiveId('main')
  }

  const handleAdd = async () => {
    const filename = window.prompt('Filename for the new file:')
    if (!filename) return
    try {
      const created = await window.api.agents.files.create(agent.id, {
        filename, content: '', sortOrder: files.length,
      })
      const next = await window.api.agents.files.list(agent.id)
      setFiles(next)
      setActiveId(created.id)
    } catch (err) {
      window.alert(`Add file failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="agent-detail-files">
      <aside className="agent-detail-files-list">
        <div className="agent-detail-files-section">Main</div>
        <FileItem
          name="SKILL.md"
          isMain
          active={activeId === 'main'}
          onSelect={() => setActiveId('main')}
        />
        {references.length > 0 && <div className="agent-detail-files-section">References</div>}
        {references.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {scripts.length > 0 && <div className="agent-detail-files-section">Scripts</div>}
        {scripts.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
        ))}
        {others.length > 0 && <div className="agent-detail-files-section">Other</div>}
        {others.map(f => (
          <FileItem key={f.id} name={f.filename} active={activeId === f.id} onSelect={() => setActiveId(f.id)} />
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
          <span className="agent-detail-files-name">{activeFilename}</span>
          {activeId !== 'main' && (
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
        <textarea
          className="agent-detail-files-textarea"
          aria-label="File content"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={onBlurSave}
        />
      </section>
    </div>
  )
}

function FileItem({
  name, isMain, active, onSelect,
}: { name: string; isMain?: boolean; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={
        'agent-detail-files-item'
        + (active ? ' agent-detail-files-item--active' : '')
        + (isMain ? ' agent-detail-files-item--main' : '')
      }
      onClick={onSelect}
    >
      <FileText size={13} />
      {name}
    </button>
  )
}
