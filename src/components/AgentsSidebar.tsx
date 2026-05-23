import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import type { AgentRow, AgentFolderRow } from '../types/agent'
import NewAgentModal from './NewAgentModal'

interface Props {
  searchTerm?: string
}

interface FolderGroup {
  id: string | null   // null = synthetic "Unfiled"
  name: string
  agents: AgentRow[]
}

function MarkdownDocIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5zM7 13h2v5H7v-5zm4-2h2v7h-2v-7zm4 3h2v4h-2v-4z" />
    </svg>
  )
}

export default function AgentsSidebar({ searchTerm = '' }: Props) {
  const navigate = useNavigate()
  const agentMatch = useMatch('/library/agent/:id')
  const selectedId = agentMatch?.params.id ?? null

  const [folders, setFolders] = useState<AgentFolderRow[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)

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
      .sort((a, b) => a.name.localeCompare(b.name))
    const out: FolderGroup[] = []
    if (unfiled.length > 0) out.push({ id: null, name: 'Unfiled', agents: unfiled })
    return out.concat(folderGroups)
  }, [folders, agents, searchTerm])

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleCreated = (newId: string) => {
    setShowModal(false)
    navigate(`/library/agent/${newId}`)
  }

  return (
    <>
      <div style={{ padding: '8px', flexShrink: 0 }}>
        <button
          type="button"
          className="library-sidebar-seg"
          style={{ width: '100%' }}
          onClick={() => setShowModal(true)}
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
                title={a.name}
              >
                <span className="library-sidebar-avatar library-sidebar-local-avatar">
                  <MarkdownDocIcon />
                </span>
                <span className="library-sidebar-name">{a.name}</span>
              </button>
            ))}
          </div>
        )
      })}

      {showModal && (
        <NewAgentModal
          folders={folders}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}
