import { useEffect, useState } from 'react'
import type { DiscoveredPlugin } from '../../electron/services/skillImportService'
import type { AgentFolderRow } from '../types/agent'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImportSkillDialog({ open, onClose }: Props) {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const list = await window.api.agents.import.discoverPlugins()
      if (!cancelled) setPlugins(list)
    })()
    return () => { cancelled = true }
  }, [open])

  const expanded = plugins?.find(p => p.id === expandedId) ?? null

  const handleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
    const plug = plugins?.find(p => p.id === id)
    if (plug) {
      setSelected(new Set(plug.skills.map(s => s.path)))
    }
  }

  const toggleSkill = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleImport = async () => {
    if (!expanded) return
    setBusy(true)
    const failures: { name: string; error: string }[] = []
    try {
      const { folders } = await window.api.agents.getAll()
      let folder: AgentFolderRow | undefined = folders.find((f: AgentFolderRow) => f.name === expanded.name)
      if (!folder) folder = await window.api.agents.createFolder(expanded.name)
      const folderId = folder.id

      for (const skill of expanded.skills) {
        if (!selected.has(skill.path)) continue
        try {
          const parsed = await window.api.agents.import.readSkillFromDisk(skill.path)
          parsed.origin = { plugin: expanded.name, pluginVersion: expanded.version, path: skill.path }
          await window.api.agents.import.importSkill(parsed, { folderId, onConflict: 'rename' })
        } catch (err) {
          // Isolate failures so one bad skill doesn't abort the whole batch.
          failures.push({ name: skill.name, error: (err as Error).message })
        }
      }
      if (failures.length > 0) {
        const msg = `Imported with ${failures.length} failure${failures.length === 1 ? '' : 's'}:\n\n`
          + failures.map(f => `· ${f.name}: ${f.error}`).join('\n')
        window.alert(msg)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="import-skill-overlay" role="dialog" aria-label="Import skill">
      <div className="import-skill-modal">
        <header className="import-skill-header">
          <h2>Import skill</h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section className="import-skill-section">
          <div className="import-skill-section-label">Installed plugins</div>
          {plugins === null && <div className="import-skill-loading">Scanning…</div>}
          {plugins !== null && plugins.length === 0 && (
            <div className="import-skill-empty">No plugins found.</div>
          )}
          {plugins?.map(p => (
            <div key={p.id} className="import-skill-plugin">
              <button
                type="button"
                className="import-skill-plugin-row"
                onClick={() => handleExpand(p.id)}
                aria-expanded={expandedId === p.id}
              >
                <span className="import-skill-plugin-name">{p.name}</span>
                {p.version && <span className="import-skill-plugin-version">v{p.version}</span>}
                <span className="import-skill-plugin-count">
                  {p.skills.length} {p.skills.length === 1 ? 'skill' : 'skills'}
                </span>
              </button>
              {expandedId === p.id && (
                <div className="import-skill-plugin-skills">
                  {p.skills.map(s => (
                    <label key={s.path} className="import-skill-skill-row">
                      <input
                        type="checkbox"
                        checked={selected.has(s.path)}
                        onChange={() => toggleSkill(s.path)}
                      />
                      <span className="import-skill-skill-name">{s.name}</span>
                      {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="import-skill-import-btn"
                    onClick={handleImport}
                    disabled={busy || selected.size === 0}
                  >
                    Import {selected.size} {selected.size === 1 ? 'skill' : 'skills'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
