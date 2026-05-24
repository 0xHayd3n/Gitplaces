import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import AgentContextMenu, { type AgentMenuKind } from './AgentContextMenu'

interface Props {
  searchTerm?: string
}

interface FolderGroup {
  id: string | null   // null = synthetic "Unfiled"
  name: string
  agents: AgentRow[]
}

export default function AgentsSidebar({ searchTerm = '' }: Props) {
  const navigate = useNavigate()
  const agentMatch = useMatch('/library/agent/:id')
  const selectedId = agentMatch?.params.id ?? null

  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; target: AgentMenuKind } | null>(null)

  const onAgentRightClick = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'agent', agentId } })
  }

  const onFolderRightClick = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', folderId } })
  }

  const handleRenameAgent = async (id: string) => {
    const current = agents.find(a => a.id === id)
    const next = prompt('Rename agent', current?.name ?? '')
    if (next != null) await window.api.agents.update(id, { name: next })
  }

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Delete this agent? This cannot be undone.')) return
    await window.api.agents.delete(id)
  }

  const handleDuplicate = async (id: string) => {
    await window.api.agents.duplicate(id)
  }

  const handleRenameFolder = async (id: string) => {
    const current = folders.find(f => f.id === id)
    const next = prompt('Rename folder', current?.name ?? '')
    if (next != null) await window.api.agents.renameFolder(id, next)
  }

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Delete this folder? Agents inside it will move to Unfiled.')) return
    await window.api.agents.deleteFolder(id)
  }

  const handleMoveAgent = async (id: string) => {
    const choice = prompt(
      'Move to folder. Type folder name (blank for Unfiled):',
      '',
    )
    if (choice === null) return
    if (choice.trim() === '') {
      await window.api.agents.update(id, { folderId: null })
      return
    }
    const f = folders.find(x => x.name.toLowerCase() === choice.trim().toLowerCase())
    if (f) {
      await window.api.agents.update(id, { folderId: f.id })
    } else {
      const created = await window.api.agents.createFolder(choice.trim())
      await window.api.agents.update(id, { folderId: created.id })
    }
  }

  const load = useCallback(async () => {
    const data = await window.api.agents.getAll()
    setFolders(data.folders)
    setAgents(data.agents)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const cb = () => load()
    window.api.agents.onChanged(cb)
    return () => window.api.agents.offChanged(cb)
  }, [load])

  const groups: FolderGroup[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const match = (a: AgentRow) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q)

    const byFolder = new Map<string, AgentRow[]>()
    const unfiled: AgentRow[] = []
    for (const a of agents) {
      if (!match(a)) continue
      if (a.folder_id === null) unfiled.push(a)
      else {
        const arr = byFolder.get(a.folder_id) ?? []
        arr.push(a)
        byFolder.set(a.folder_id, arr)
      }
    }
    const folderGroups: FolderGroup[] = folders
      .map(f => ({
        id: f.id,
        name: f.name,
        agents: byFolder.get(f.id) ?? [],
      }))
      .filter(g => q === '' || g.agents.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    const out: FolderGroup[] = []
    if (unfiled.length > 0) out.push({ id: null, name: 'Unfiled', agents: unfiled })
    return out.concat(folderGroups)
  }, [folders, agents, searchTerm])

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleNewAgent = () => {
    navigate('/library/agent/new')
  }

  return (
    <>
      <div style={{ padding: '8px', flexShrink: 0 }}>
        <button
          type="button"
          className="library-sidebar-seg"
          style={{ width: '100%' }}
          onClick={handleNewAgent}
        >
          + New agent
        </button>
      </div>

      {groups.length === 0 && (
        <div className="library-sidebar-empty">No agents</div>
      )}

      {groups.map(g => {
        const key = g.id ?? '__unfiled__'
        const isOpen = expanded[key] ?? true
        return (
          <div key={key} className="library-sidebar-section">
            <button
              type="button"
              className="library-sidebar-section-header"
              onClick={() => toggle(key)}
              onContextMenu={g.id ? (e) => onFolderRightClick(e, g.id!) : undefined}
              aria-expanded={isOpen}
            >
              <span className="library-sidebar-section-caret">{isOpen ? '▾' : '▸'}</span>
              {g.name} ({g.agents.length})
            </button>
            {isOpen && g.agents.map(a => (
              <button
                key={a.id}
                type="button"
                className={`library-sidebar-item installed${selectedId === a.id ? ' selected' : ''}`}
                onClick={() => navigate(`/library/agent/${a.id}`)}
                onContextMenu={(e) => onAgentRightClick(e, a.id)}
                title={`${a.name} @${a.handle}`}
              >
                <span
                  className="library-sidebar-avatar agents-sidebar-swatch"
                  data-testid={`sidebar-swatch-${a.id}`}
                  style={{
                    background: a.color_end
                      ? `linear-gradient(135deg, ${a.color_start ?? '#888'}, ${a.color_end})`
                      : (a.color_start ?? '#888'),
                  }}
                >
                  {a.emoji ?? ''}
                </span>
                <span className="library-sidebar-name">{a.name}</span>
                <span className="agents-sidebar-handle">@{a.handle}</span>
                {a.pinned === 1 && (
                  <span className="agents-sidebar-row-pin" aria-label="Pinned" title="Pinned">★</span>
                )}
              </button>
            ))}
          </div>
        )
      })}

      {menu && (
        <AgentContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
          onRenameAgent={handleRenameAgent}
          onMoveAgent={handleMoveAgent}
          onDuplicate={handleDuplicate}
          onDeleteAgent={handleDeleteAgent}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
      )}
    </>
  )
}
