import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRow, AgentPreset } from '../types/agent'
import { parseAgentPresets } from '../types/agent'
import { buildPersonaPayload, deriveDescription } from '../utils/copyPayload'

interface Props {
  agent: AgentRow
  variables: string[]
  activePresetId: string | null
  onActivePresetChange: (id: string | null) => void
}

const SAVE_DEBOUNCE_MS = 500

export default function AgentVariablePresetBar({
  agent,
  variables,
  activePresetId,
  onActivePresetChange,
}: Props) {
  const presets = useMemo(() => parseAgentPresets(agent.presets_json), [agent.presets_json])
  const activePreset = useMemo(
    () => presets.find(p => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  )

  // localValues holds the user's typed values for the current state. When a
  // preset is active, it mirrors the preset's values; when no preset is active,
  // it holds local edits that can be snapshotted via "+ New preset".
  const [localValues, setLocalValues] = useState<Record<string, string>>(
    activePreset?.values ?? {},
  )

  // Sync localValues whenever the active preset changes (or its values change
  // from outside, e.g. another window edited the same preset).
  useEffect(() => {
    setLocalValues(activePreset?.values ?? {})
  }, [activePreset])

  // Debounced save: when localValues change while a preset is active, push to
  // window.api.agents.presets.update.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((nextValues: Record<string, string>) => {
    if (!activePreset) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await window.api.agents.presets.update(agent.id, activePreset.id, { values: nextValues })
      } catch {
        // The 'agents:changed' broadcast will reconcile on next fetch.
      }
    }, SAVE_DEBOUNCE_MS)
  }, [activePreset, agent.id])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const handleVarChange = (name: string, value: string) => {
    const next = { ...localValues, [name]: value }
    setLocalValues(next)
    scheduleSave(next)
  }

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const startCreate = () => { setCreating(true); setNewName(''); setCreateError(null) }
  const cancelCreate = () => { setCreating(false); setNewName(''); setCreateError(null) }
  const submitCreate = async () => {
    const trimmed = newName.trim()
    if (trimmed.length === 0) { setCreateError('Name required'); return }
    try {
      const created = await window.api.agents.presets.create(agent.id, trimmed, { ...localValues })
      onActivePresetChange(created.id)
      setCreating(false)
      setNewName('')
      setCreateError(null)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create preset')
    }
  }

  const previewPayload = useMemo(() => {
    const description = deriveDescription(agent.body)
    return buildPersonaPayload({
      handle: agent.handle,
      description,
      body: agent.body,
      presetSlug: activePreset?.slug ?? null,
      presetValues: activePreset ? localValues : undefined,
    })
  }, [agent.body, agent.handle, activePreset, localValues])

  return (
    <div className="agent-bar">
      <aside className="agent-bar-presets">
        <div className="agent-bar-presets-label">PRESETS</div>
        {presets.map(p => (
          <PresetRow
            key={p.id}
            agent={agent}
            preset={p}
            active={p.id === activePresetId}
            onClick={() => onActivePresetChange(p.id)}
          />
        ))}
        {creating ? (
          <div className="agent-bar-new-form">
            <input
              autoFocus
              className="agent-bar-new-input"
              placeholder="Preset name"
              value={newName}
              onChange={e => { setNewName(e.target.value); if (createError) setCreateError(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitCreate() }
                else if (e.key === 'Escape') { e.preventDefault(); cancelCreate() }
              }}
              onBlur={() => { if (newName.trim().length === 0) cancelCreate() }}
              maxLength={80}
            />
            {createError && <div className="agent-bar-new-error">{createError}</div>}
          </div>
        ) : (
          <button
            type="button"
            className="agent-bar-new-btn"
            onClick={startCreate}
          >
            + New preset
          </button>
        )}
      </aside>

      <section className="agent-bar-content">
        <header className="agent-bar-header">
          <span className="agent-bar-sub-handle">
            <span>{`@${agent.handle}`}</span>
            {activePreset ? <span>{`/${activePreset.slug}`}</span> : null}
          </span>
          <span className="agent-bar-meta">
            {variables.length} variable{variables.length === 1 ? '' : 's'}
          </span>
        </header>

        <div className="agent-bar-vars">
          {variables.map(name => (
            <div key={name} className="agent-bar-var-row">
              <label className="agent-bar-var-name" htmlFor={`var-${name}`}>{`{{${name}}}`}</label>
              <input
                id={`var-${name}`}
                className="agent-bar-var-input"
                aria-label={name}
                value={localValues[name] ?? ''}
                onChange={e => handleVarChange(name, e.target.value)}
                placeholder={`value for ${name}`}
              />
            </div>
          ))}
        </div>

        <div className="agent-bar-preview-block">
          <div className="agent-bar-preview-label">COPY PAYLOAD PREVIEW</div>
          <pre className="agent-bar-preview" data-testid="agent-bar-preview">
            {previewPayload}
          </pre>
        </div>
      </section>
    </div>
  )
}

interface PresetRowProps {
  agent: AgentRow
  preset: AgentPreset
  active: boolean
  onClick: () => void
}

function PresetRow({ agent, preset, active, onClick }: PresetRowProps) {
  return (
    <button
      type="button"
      aria-label={`Activate preset ${preset.name}`}
      className={`agent-bar-preset${active ? ' agent-bar-preset--active' : ''}`}
      onClick={onClick}
    >
      <span className="agent-bar-preset-dot" aria-hidden="true">●</span>
      <div className="agent-bar-preset-text">
        <div className="agent-bar-preset-name">{preset.name}</div>
        <div className="agent-bar-preset-handle">@{agent.handle}/{preset.slug}</div>
      </div>
    </button>
  )
}
