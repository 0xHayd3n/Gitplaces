import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { Folder, Plus, Settings } from 'lucide-react'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import AgentContextMenu from './AgentContextMenu'
import FolderKebabMenu from './FolderKebabMenu'
import ImportPluginDialog from './ImportPluginDialog'

type SidebarMenuTarget =
  | { kind: 'agent';  agentId: string }
  | { kind: 'folder'; folderId: string | null }   // null = synthetic Unfiled

interface Props {
  searchTerm?: string
}

interface FolderGroup {
  id: string | null   // null = synthetic "Unfiled"
  name: string
  emoji: string | null
  color: string | null
  agents: AgentRow[]
}

export default function AgentsSidebar({ searchTerm = '' }: Props) {
  const navigate = useNavigate()
  const agentMatch = useMatch('/library/agent/:id')
  const selectedId = agentMatch?.params.id ?? null

  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [agents,  setAgents]  = useState<AgentRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; target: SidebarMenuTarget } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const newMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showNewMenu) return
    function handle(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false)
      }
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') setShowNewMenu(false) }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown',  key)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown',  key)
    }
  }, [showNewMenu])

  const onAgentRightClick = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'agent', agentId } })
  }

  const onFolderRightClick = (e: React.MouseEvent, folderId: string | null) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', folderId } })
  }

  const onFolderKebabClick = (e: React.MouseEvent, folderId: string | null) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
    setMenu({ x: rect.right - 4, y: rect.bottom + 4, target: { kind: 'folder', folderId } })
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

  const startInlineRename = (folderId: string) => {
    const f = folders.find(x => x.id === folderId)
    if (!f) return
    setRenamingId(folderId)
    setRenameDraft(f.name)
  }

  const commitRename = async () => {
    if (renamingId === null) return
    const id = renamingId
    const draft = renameDraft
    setRenamingId(null)
    setRenameDraft('')
    await window.api.agents.updateFolder(id, { name: draft })
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('Delete this folder? Agents inside it will move to Unfiled.')) return
    await window.api.agents.deleteFolder(id)
  }

  const handleNewFolder = async () => {
    const name = prompt('Folder name')
    if (name === null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    await window.api.agents.createFolder(trimmed)
  }

  const handleMoveAgent = async (id: string) => {
    const choice = prompt('Move to folder. Type folder name (blank for Unfiled):', '')
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

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const groups: FolderGroup[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    // Sidebar search matches name + description (body now lives in agent_files;
    // searching it would require an N+1 join we don't want for a sidebar render).
    const match = (a: AgentRow) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.handle.toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q)

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
        emoji: f.emoji,
        color: f.color_start,
        agents: byFolder.get(f.id) ?? [],
      }))
      .filter(g => q === '' || g.agents.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    const out: FolderGroup[] = []
    if (unfiled.length > 0) {
      out.push({ id: null, name: 'Unfiled', emoji: null, color: null, agents: unfiled })
    }
    return out.concat(folderGroups)
  }, [folders, agents, searchTerm])

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleNewAgent = () => {
    navigate('/library/agent/new')
  }

  // Narrow the discriminated union to a local first; TypeScript can't follow
  // the narrowing across `menu?.target.kind === 'folder' && menu.target.folderId`
  // because the optional-chain breaks the discriminant flow.
  const folderTarget = menu && menu.target.kind === 'folder' ? menu.target : null
  const currentMenuFolder = folderTarget && folderTarget.folderId !== null
    ? folders.find(f => f.id === folderTarget.folderId) ?? null
    : null

  return (
    <div className="agents-sidebar-root">
      {groups.length === 0 && (
        <div className="library-sidebar-empty">No agents</div>
      )}

      {groups.map(g => {
        const key = g.id ?? '__unfiled__'
        const isOpen = expanded[key] ?? true
        const isRenaming = g.id !== null && renamingId === g.id
        const headerStyle = g.color ? ({ ['--folder-accent' as any]: g.color } as React.CSSProperties) : undefined
        return (
          <div key={key} className="library-sidebar-section">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              className="agents-sidebar-folder-header"
              data-has-accent={g.color ? 'true' : undefined}
              style={headerStyle}
              onClick={() => { if (!isRenaming) toggle(key) }}
              onKeyDown={(e) => {
                if (isRenaming) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(key)
                }
              }}
              onContextMenu={g.id !== null ? (e) => onFolderRightClick(e, g.id!) : undefined}
            >
              <span
                className="agents-sidebar-folder-avatar"
                data-testid={g.id ? `folder-avatar-${g.id}` : 'folder-avatar-unfiled'}
              >
                {!isOpen && g.agents.length > 0 && (
                  <span
                    className="agents-sidebar-folder-badge"
                    data-testid={g.id ? `folder-badge-${g.id}` : 'folder-badge-unfiled'}
                  >{g.agents.length}</span>
                )}
                {g.emoji ?? <Folder size={14} strokeWidth={1.8} fill="currentColor" />}
              </span>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="agents-sidebar-folder-rename-input"
                  data-testid={`folder-rename-${g.id}`}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span
                  className="agents-sidebar-folder-name"
                  data-testid={g.id ? `folder-name-${g.id}` : 'folder-name-unfiled'}
                  onDoubleClick={(e) => {
                    if (!g.id) return
                    e.stopPropagation()
                    startInlineRename(g.id)
                  }}
                >
                  {g.name}
                </span>
              )}
              {g.id !== null && (
                <button
                  type="button"
                  className="agents-sidebar-folder-kebab"
                  data-testid={`folder-kebab-${g.id}`}
                  aria-label="Customise folder"
                  onClick={(e) => onFolderKebabClick(e, g.id)}
                >
                  <Settings size={14} />
                </button>
              )}
            </div>

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

      <div className="agents-sidebar-new-wrap" ref={newMenuRef}>
        {showNewMenu && (
          <div className="agents-sidebar-new-menu" role="menu">
            <button
              role="menuitem"
              type="button"
              onClick={() => { setShowNewMenu(false); handleNewAgent() }}
            >New agent</button>
            <button
              role="menuitem"
              type="button"
              onClick={() => { setShowNewMenu(false); setShowImport(true) }}
            >Import skill…</button>
            <button
              role="menuitem"
              type="button"
              onClick={() => { setShowNewMenu(false); handleNewFolder() }}
            >New folder</button>
          </div>
        )}
        <button
          type="button"
          className="agents-sidebar-new-plus"
          aria-label="Create new"
          aria-expanded={showNewMenu}
          onClick={() => setShowNewMenu(v => !v)}
        >
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>

      {menu && menu.target.kind === 'agent' && (
        <AgentContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
          onRenameAgent={handleRenameAgent}
          onMoveAgent={handleMoveAgent}
          onDuplicate={handleDuplicate}
          onDeleteAgent={handleDeleteAgent}
        />
      )}

      {menu && menu.target.kind === 'folder' && menu.target.folderId !== null && currentMenuFolder && (
        <FolderKebabMenu
          x={menu.x}
          y={menu.y}
          folderId={menu.target.folderId}
          currentColor={currentMenuFolder.color_start}
          currentEmoji={currentMenuFolder.emoji}
          onClose={() => setMenu(null)}
          onRename={(id) => startInlineRename(id)}
          onDelete={handleDeleteFolder}
        />
      )}

      <ImportPluginDialog open={showImport} onClose={() => setShowImport(false)} />
    </div>
  )
}
