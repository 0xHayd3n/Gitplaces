import { Copy, Edit3, Folder, FileText, Clock, Settings as SettingsIcon, ChevronRight, Star, Wrench } from 'lucide-react'
import type { AgentRow, AgentFolderRow, AgentPreset, AgentRevision } from '../types/agent'
import { parseAgentTools } from '../types/agent'
import { detectVariables } from '../utils/agentVariables'
import { relativeTime } from '../utils/relativeTime'
import { deriveDescription } from '../utils/copyPayload'

interface Props {
  agent: AgentRow
  folders: AgentFolderRow[]
  liveBody: string
  presets: AgentPreset[]
  activePresetId: string | null
  recentRevisions: AgentRevision[]
  fileCount: number
  onCopy: () => void
  onOpenEditor: () => void
  onTabChange: (tab: 'preview' | 'mcp' | 'history' | 'files' | 'settings') => void
  onActivePresetChange: (id: string | null) => void
}

export default function AgentOverviewTab({
  agent, folders, liveBody, presets, activePresetId, recentRevisions, fileCount,
  onCopy, onOpenEditor, onTabChange, onActivePresetChange,
}: Props) {
  const folderName = agent.folder_id === null ? 'Unfiled'
    : folders.find(f => f.id === agent.folder_id)?.name ?? 'Unfiled'
  const tools = parseAgentTools(agent.tools)
  const variables = detectVariables(liveBody)
  const explicit = (agent.description ?? '').trim()
  const description = explicit || deriveDescription(liveBody)
  const hasExplicitDescription = explicit.length > 0
  const top3Revisions = recentRevisions.slice(0, 3)

  return (
    <div className="agent-overview">
      {/* Hero card */}
      <section className="agent-overview-hero">
        <p className={'agent-overview-description' + (hasExplicitDescription ? '' : ' agent-overview-description--derived')}>
          {description}
        </p>
        {!hasExplicitDescription && (
          <p className="agent-overview-hint">Set an explicit description in Settings.</p>
        )}
        <div className="agent-overview-chips">
          <span className="agent-overview-chip"><Folder size={11} /> {folderName}</span>
          <span className="agent-overview-chip"><SettingsIcon size={11} /> {agent.model}</span>
          {tools !== null && tools.length > 0 && (
            <span className="agent-overview-chip"><Wrench size={11} /> {tools.length} tools</span>
          )}
          <span className="agent-overview-chip"><FileText size={11} /> {fileCount} files</span>
          {agent.last_used_at && (
            <span className="agent-overview-chip"><Clock size={11} /> used {relativeTime(agent.last_used_at)}</span>
          )}
        </div>

        {presets.length > 0 && (
          <div className="agent-overview-preset-row">
            <label htmlFor="overview-active-preset" className="agent-overview-preset-label">
              Active preset
            </label>
            <select
              id="overview-active-preset"
              value={activePresetId ?? ''}
              onChange={e => onActivePresetChange(e.target.value || null)}
              className="agent-overview-preset-select"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {variables.length > 0 && (
              <div className="agent-overview-var-chips">
                {variables.map(v => (
                  <span key={v} className="agent-overview-var-chip">{`{{${v}}}`}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="agent-overview-actions">
          <button type="button" className="agent-overview-btn agent-overview-btn--primary" onClick={onCopy}>
            <Copy size={13} /> Copy prompt
          </button>
          <button type="button" className="agent-overview-btn" onClick={onOpenEditor}>
            <Edit3 size={13} /> Open in editor <ChevronRight size={13} />
          </button>
        </div>
      </section>

      <div className="agent-overview-split">
        {/* Left column */}
        <div className="agent-overview-col">
          <SurfaceSummaryCard
            kind="subagent"
            enabled={agent.is_subagent === 1}
            syncedAt={agent.synced_subagent_at}
            onConfigure={() => onTabChange('settings')}
          />
          <SurfaceSummaryCard
            kind="slashCommand"
            enabled={agent.is_slash_command === 1}
            syncedAt={agent.synced_slash_command_at}
            onConfigure={() => onTabChange('settings')}
          />
          {variables.length > 0 && (
            <div className="agent-overview-card">
              <h4>Variables</h4>
              <div className="agent-overview-var-chips">
                {variables.map(v => (
                  <span key={v} className="agent-overview-var-chip">{`{{${v}}}`}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="agent-overview-col">
          <div className="agent-overview-card">
            <h4>Files <span className="agent-overview-card-meta">{fileCount}</span></h4>
            <FilesPreview
              agentHandle={agent.handle}
              fileCount={fileCount}
              onOpenEditor={onOpenEditor}
            />
          </div>
          <div className="agent-overview-card">
            <h4>Recent revisions</h4>
            {top3Revisions.length === 0 ? (
              <p className="agent-overview-empty">No revisions yet</p>
            ) : (
              <>
                <ul className="agent-overview-revisions">
                  {top3Revisions.map(r => (
                    <li key={r.id}>
                      <span>{r.summary}</span>
                      <span className="agent-overview-revision-time">{relativeTime(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="agent-overview-link"
                  onClick={() => onTabChange('history')}
                >
                  View all <ChevronRight size={11} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SurfaceSummaryCardProps {
  kind: 'subagent' | 'slashCommand'
  enabled: boolean
  syncedAt: string | null
  onConfigure: () => void
}

function SurfaceSummaryCard({ kind, enabled, syncedAt, onConfigure }: SurfaceSummaryCardProps) {
  const label = kind === 'subagent' ? 'Subagent' : 'Slash command'
  return (
    <div className="agent-overview-card">
      <h4>{label}</h4>
      {!enabled ? (
        <p className="agent-overview-empty">
          Disabled ·{' '}
          <button type="button" className="agent-overview-link" onClick={onConfigure}>
            Enable in Settings <ChevronRight size={11} />
          </button>
        </p>
      ) : syncedAt ? (
        <p className="agent-overview-synced">
          <Star size={11} /> Synced {relativeTime(syncedAt)}
        </p>
      ) : (
        <p className="agent-overview-empty">Pending sync — will sync on next save</p>
      )}
    </div>
  )
}

interface FilesPreviewProps {
  agentHandle: string
  fileCount: number
  onOpenEditor: () => void
}

function FilesPreview({ agentHandle, fileCount, onOpenEditor }: FilesPreviewProps) {
  return (
    <div className="agent-overview-files-preview">
      <button type="button" className="agent-overview-file agent-overview-file--primary" onClick={onOpenEditor}>
        <Star size={11} /> {agentHandle}.md
      </button>
      {fileCount > 1 && (
        <button type="button" className="agent-overview-link" onClick={onOpenEditor}>
          + {fileCount - 1} more <ChevronRight size={11} />
        </button>
      )}
    </div>
  )
}
