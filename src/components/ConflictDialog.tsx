import React from 'react'
import { AlertTriangle, FolderOpen } from 'lucide-react'

interface ConflictDialogProps {
  open: boolean
  surface: 'subagent' | 'slash command'
  path: string
  onCancel: () => void
  onOverwrite: () => void
}

export function ConflictDialog({ open, surface, path, onCancel, onOverwrite }: ConflictDialogProps) {
  if (!open) return null
  const openContainingFolder = () => {
    // Open the parent directory in the OS file browser
    const parent = path.replace(/[^/\\]+$/, '')
    void window.api.openExternal(`file:///${parent.replace(/\\/g, '/')}`)
  }
  return (
    <div className="agent-detail-modal-backdrop" onClick={onCancel}>
      <div className="agent-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="agent-detail-modal-header">
          <AlertTriangle size={16} />
          <h3>{surface === 'subagent' ? 'Subagent file exists' : 'Slash command file exists'}</h3>
        </div>
        <div className="agent-detail-modal-body">
          <p>A file already exists at:</p>
          <pre className="agent-detail-modal-path">{path}</pre>
          <p>
            Enabling "{surface === 'subagent' ? 'Available as subagent' : 'Available as slash command'}"
            will overwrite it with the content from this agent. The existing file's content will be lost.
          </p>
          <button
            type="button"
            className="agent-detail-modal-link"
            onClick={openContainingFolder}
          >
            <FolderOpen size={13} /> Open containing folder
          </button>
        </div>
        <div className="agent-detail-modal-footer">
          <button type="button" className="agent-detail-settings-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="agent-detail-settings-btn agent-detail-settings-btn--danger"
            onClick={onOverwrite}
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  )
}
