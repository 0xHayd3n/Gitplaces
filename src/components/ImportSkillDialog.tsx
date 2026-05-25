import { useEffect, useMemo, useState } from 'react'
import type { DiscoveredPlugin } from '../../electron/services/skillImportService'
import type { RepoSkillIndex } from '../../electron/services/skillImportFromGithubService'
import type { AgentFolderRow } from '../types/agent'
import { parseGithubRepoUrl } from '../utils/parseGithubRepoUrl'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImportSkillDialog({ open, onClose }: Props) {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const [repoUrl, setRepoUrl] = useState('')
  const [repoIndex, setRepoIndex] = useState<RepoSkillIndex | null>(null)
  const [repoFetching, setRepoFetching] = useState(false)
  const [repoFetchError, setRepoFetchError] = useState<string | null>(null)
  const [repoSelected, setRepoSelected] = useState<Set<string>>(new Set())
  const [repoImporting, setRepoImporting] = useState(false)

  const repoUrlValid = useMemo(() => parseGithubRepoUrl(repoUrl) !== null, [repoUrl])
  const repoUrlError = repoUrl.length > 0 && !repoUrlValid ? 'Not a valid GitHub URL' : null

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

  const handleFetchRepo = async () => {
    if (!repoUrlValid) return
    setRepoFetching(true)
    setRepoFetchError(null)
    try {
      const index = await window.api.agents.import.discoverInRepo(repoUrl)
      setRepoIndex(index)
      setRepoSelected(new Set(index.skills.map(s => s.path)))
    } catch (err) {
      setRepoFetchError((err as Error).message)
    } finally {
      setRepoFetching(false)
    }
  }

  const handleClearRepo = () => {
    setRepoIndex(null)
    setRepoSelected(new Set())
    setRepoFetchError(null)
  }

  const toggleRepoSkill = (path: string) => {
    setRepoSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleImportRepo = async () => {
    if (!repoIndex) return
    setRepoImporting(true)
    const failures: { name: string; error: string }[] = []
    try {
      const { folders } = await window.api.agents.getAll()
      let folder: AgentFolderRow | undefined = folders.find((f: AgentFolderRow) => f.name === repoIndex.name)
      if (!folder) folder = await window.api.agents.createFolder(repoIndex.name)
      const folderId = folder.id

      for (const skill of repoIndex.skills) {
        if (!repoSelected.has(skill.path)) continue
        try {
          const parsed = await window.api.agents.import.readSkillFromRepo(
            repoIndex.owner, repoIndex.name, repoIndex.branch, repoIndex.commitSha, skill.path,
          )
          await window.api.agents.import.importSkill(parsed, { folderId, onConflict: 'rename' })
        } catch (err) {
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
      setRepoImporting(false)
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
                    disabled={busy || repoImporting || selected.size === 0}
                  >
                    Import {selected.size} {selected.size === 1 ? 'skill' : 'skills'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="import-skill-section">
          <div className="import-skill-section-label">From GitHub repository</div>

          {repoIndex === null && (
            <>
              <div className="import-skill-github-input-row">
                <input
                  type="text"
                  className="import-skill-github-input"
                  placeholder="owner/repo or https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && repoUrlValid && !repoFetching) handleFetchRepo() }}
                  disabled={repoFetching || repoImporting}
                />
                <button
                  type="button"
                  className="import-skill-github-fetch-btn"
                  onClick={handleFetchRepo}
                  disabled={!repoUrlValid || repoFetching || repoImporting}
                >
                  {repoFetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {repoUrlError && <div className="import-skill-github-error">{repoUrlError}</div>}
              {repoFetchError && <div className="import-skill-github-error">{repoFetchError}</div>}
            </>
          )}

          {repoIndex !== null && (
            <div className="import-skill-github-skills">
              <div className="import-skill-github-chip">
                <span>
                  {repoIndex.owner}/{repoIndex.name}
                  {' '}({repoIndex.branch} @ {repoIndex.commitSha.slice(0, 7)})
                </span>
                <button
                  type="button"
                  className="import-skill-github-chip-clear"
                  onClick={handleClearRepo}
                  aria-label="Clear"
                  disabled={repoImporting}
                >✕</button>
              </div>

              {repoIndex.skills.length === 0 && (
                <div className="import-skill-empty">
                  No skills found in this repo. Looked for <code>skills/&lt;name&gt;/SKILL.md</code> and root <code>SKILL.md</code>.
                </div>
              )}

              {repoIndex.skills.map(s => (
                <label key={s.path} className="import-skill-skill-row">
                  <input
                    type="checkbox"
                    checked={repoSelected.has(s.path)}
                    onChange={() => toggleRepoSkill(s.path)}
                    disabled={repoImporting}
                  />
                  <span className="import-skill-skill-name">{s.name}</span>
                  {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                </label>
              ))}

              {repoIndex.skills.length > 0 && (
                <button
                  type="button"
                  className="import-skill-import-btn"
                  onClick={handleImportRepo}
                  disabled={repoImporting || repoSelected.size === 0}
                >
                  {repoImporting ? 'Importing…' : `Import ${repoSelected.size} ${repoSelected.size === 1 ? 'skill' : 'skills'}`}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
