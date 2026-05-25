import React, { useState } from 'react'
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import { ConflictDialog } from './ConflictDialog'
import { useToast } from '../contexts/Toast'

interface SurfaceToggleProps {
  agentId: string
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}

export function SurfaceToggle({ agentId, kind, enabled, syncedAt }: SurfaceToggleProps) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<{ path: string } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const applyToggle = async (next: boolean, forceOverwrite = false) => {
    setPending(true)
    try {
      const patch = kind === 'subagent'
        ? { isSubagent: next, forceOverwrite }
        : { isSlashCommand: next, forceOverwrite }
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
              Synced {relativeTime(syncedAt)}
              <ExternalLink size={11} />
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
