import { useEffect, useRef } from 'react'

export type AgentMenuKind =
  | { kind: 'agent';  agentId: string }
  | { kind: 'folder'; folderId: string }

interface Props {
  x: number
  y: number
  target: AgentMenuKind
  onClose: () => void
  onRenameAgent?: (id: string) => void
  onMoveAgent?:   (id: string) => void
  onDuplicate?:   (id: string) => void
  onDeleteAgent?: (id: string) => void
  onRenameFolder?: (id: string) => void
  onDeleteFolder?: (id: string) => void
}

export default function AgentContextMenu({
  x, y, target, onClose,
  onRenameAgent, onMoveAgent, onDuplicate, onDeleteAgent,
  onRenameFolder, onDeleteFolder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const style: React.CSSProperties = {
    position: 'fixed', top: y, left: x, zIndex: 1000,
    background: 'var(--bg2)', border: '1px solid var(--border)',
    padding: 4, minWidth: 160,
  }

  if (target.kind === 'agent') {
    return (
      <div ref={ref} role="menu" style={style}>
        <button role="menuitem" type="button" onClick={() => { onRenameAgent?.(target.agentId); onClose() }}>Rename</button>
        <button role="menuitem" type="button" onClick={() => { onMoveAgent?.(target.agentId); onClose() }}>Move to folder…</button>
        <button role="menuitem" type="button" onClick={() => { onDuplicate?.(target.agentId); onClose() }}>Duplicate</button>
        <button role="menuitem" type="button" onClick={() => { onDeleteAgent?.(target.agentId); onClose() }}>Delete</button>
      </div>
    )
  }

  return (
    <div ref={ref} role="menu" style={style}>
      <button role="menuitem" type="button" onClick={() => { onRenameFolder?.(target.folderId); onClose() }}>Rename folder</button>
      <button role="menuitem" type="button" disabled>Set colour</button>
      <button role="menuitem" type="button" onClick={() => { onDeleteFolder?.(target.folderId); onClose() }}>Delete folder</button>
    </div>
  )
}
