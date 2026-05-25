import React, { useState, useEffect } from 'react'
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import { ConflictDialog } from './ConflictDialog'
import { useToast } from '../contexts/Toast'
import { relativeTime } from '../utils/relativeTime'

interface SurfaceToggleProps {
  agentId: string
  agentHandle: string                  // for the clickable path display
  kind: 'subagent' | 'slashCommand'
  enabled: boolean
  syncedAt: string | null
}

const KIND_LABEL: Record<SurfaceToggleProps['kind'], string> = {
  subagent: 'Available as subagent',
  slashCommand: 'Available as slash command',
}

const KIND_FOR_DIALOG: Record<SurfaceToggleProps['kind'], 'subagent' | 'slash command'> = {
  subagent: 'subagent',
  slashCommand: 'slash command',
}

export function SurfaceToggle({ agentId, agentHandle, kind, enabled, syncedAt }: SurfaceToggleProps) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<{ path: string } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [syncedPath, setSyncedPath] = useState<string | null>(null)

  // Fetch the on-disk path lazily — once we know we're synced, ask the IPC for
  // the canonical path so the link reflects whatever CLAUDE_HOME the main process
  // is using. Re-queries when the handle moves the file or the synced/unsynced
  // state flips — not on every syncedAt timestamp bump (the path is stable
  // across re-syncs of the same handle).
  const isSynced = syncedAt !== null
  useEffect(() => {
    if (!enabled || !isSynced) {
      setSyncedPath(null)
      return
    }
    void window.api.agents.sync.checkConflict(agentId).then(info => {
      setSyncedPath(kind === 'subagent' ? info.subagentPath : info.slashCommandPath)
    }).catch(() => setSyncedPath(null))
  }, [agentId, agentHandle, kind, enabled, isSynced])

  const openContainingFolder = () => {
    if (!syncedPath) return
    void window.api.showItemInFolder(syncedPath)
  }

  const applyToggle = async (next: boolean, forceOverwrite = false) => {
    setPending(true)
    try {
      const patch: Parameters<typeof window.api.agents.update>[1] = kind === 'subagent'
        ? { isSubagent: next }
        : { isSlashCommand: next }
      // forceOverwrite is only meaningful when turning a surface ON — omit otherwise so
      // we don't send an irrelevant field over IPC on toggle-OFF.
      if (next && forceOverwrite) patch.forceOverwrite = true
      const result = await window.api.agents.update(agentId, patch)
      if (result.syncWarning) {
        setLastError(result.syncWarning)
        toast(result.syncWarning, 'error')
      } else {
        setLastError(null)
      }
    } finally {
      setPending(false)
    }
  }

  const onCheckboxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked
    if (!next) {
      await applyToggle(false)
      return
    }
    if (syncedAt === null) {
      const conflictInfo = await window.api.agents.sync.checkConflict(agentId)
      const exists = kind === 'subagent' ? conflictInfo.subagentExists : conflictInfo.slashCommandExists
      const conflictPath = kind === 'subagent' ? conflictInfo.subagentPath : conflictInfo.slashCommandPath
      if (exists) {
        setConflict({ path: conflictPath })
        return
      }
    }
    await applyToggle(true)
  }

  const onOverwrite = async () => {
    setConflict(null)
    await applyToggle(true, true)
  }

  const onRetry = async () => {
    setPending(true)
    try {
      const result = await window.api.agents.sync.retry(agentId)
      const surface = kind === 'subagent' ? result.subagent : result.slashCommand
      if (surface.status === 'error') {
        setLastError(surface.message)
        toast(surface.message, 'error')
      } else {
        setLastError(null)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="agent-detail-surface-toggle">
      <label className="agent-detail-surface-toggle-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={onCheckboxChange}
        />
        <span>{KIND_LABEL[kind]}</span>
      </label>
      {enabled && (
        <div className="agent-detail-surface-toggle-status">
          {lastError ? (
            <span className="agent-detail-surface-toggle-error">
              <AlertCircle size={11} /> Sync failed.{' '}
              <button type="button" className="agent-detail-modal-link" onClick={onRetry}>
                <RefreshCw size={11} /> Retry
              </button>
            </span>
          ) : syncedAt === null ? (
            <span className="agent-detail-surface-toggle-pending">Will sync on next save.</span>
          ) : (
            <span className="agent-detail-surface-toggle-synced">
              Synced to{' '}
              {syncedPath ? (
                <button
                  type="button"
                  className="agent-detail-modal-link"
                  onClick={openContainingFolder}
                  title="Open containing folder"
                >
                  {syncedPath}
                  <ExternalLink size={11} />
                </button>
              ) : (
                <span>…</span>
              )}
              {' · '}{relativeTime(syncedAt)}
            </span>
          )}
        </div>
      )}
      <ConflictDialog
        open={conflict !== null}
        surface={KIND_FOR_DIALOG[kind]}
        path={conflict?.path ?? ''}
        onCancel={() => setConflict(null)}
        onOverwrite={onOverwrite}
      />
    </div>
  )
}
