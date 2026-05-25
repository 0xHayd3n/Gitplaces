import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Bot, ChevronRight } from 'lucide-react'
import type { DiscoveredPlugin } from '../../electron/services/pluginImportService'
import type { RepoPluginIndex } from '../../electron/services/pluginImportFromGithubService'
import type { AgentFolderRow } from '../types/agent'
import { parseGithubRepoUrl } from '../utils/parseGithubRepoUrl'
import { COLOR_MAP } from '../utils/anthropicColors'

type ImportKind = 'skill' | 'subagent' | 'slashCommand'
type SelectionKey = `skill:${string}` | `subagent:${string}` | `slashCommand:${string}`

function keyOf(kind: ImportKind, p: string): SelectionKey {
  return `${kind}:${p}` as SelectionKey
}

function KindBadge({ kind }: { kind: ImportKind }) {
  const label = kind === 'skill' ? 'Skill' : kind === 'subagent' ? 'Sub-agent' : 'Slash command'
  const Icon = kind === 'skill' ? BookOpen : kind === 'subagent' ? Bot : ChevronRight
  return (
    <span className={`import-skill-kind-badge import-skill-kind-${kind}`} title={label} aria-label={label}>
      <Icon size={14} />
    </span>
  )
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function ImportPluginDialog({ open, onClose }: Props) {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set())
  const [busy, setBusy] = useState(false)

  const [repoUrl, setRepoUrl] = useState('')
  const [repoIndex, setRepoIndex] = useState<RepoPluginIndex | null>(null)
  const [repoFetching, setRepoFetching] = useState(false)
  const [repoFetchError, setRepoFetchError] = useState<string | null>(null)
  const [repoSelected, setRepoSelected] = useState<Set<SelectionKey>>(new Set())
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
      const all = new Set<SelectionKey>()
      plug.skills.forEach(s        => all.add(keyOf('skill',        s.path)))
      plug.subagents.forEach(s     => all.add(keyOf('subagent',     s.path)))
      plug.slashCommands.forEach(c => all.add(keyOf('slashCommand', c.path)))
      setSelected(all)
    }
  }

  const toggle = (kind: ImportKind, p: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      const k = keyOf(kind, p)
      if (next.has(k)) next.delete(k)
      else next.add(k)
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

      type Job = { kind: ImportKind; name: string; path: string }
      const jobs: Job[] = []
      expanded.skills.forEach(s => {
        if (selected.has(keyOf('skill', s.path))) jobs.push({ kind: 'skill', name: s.name, path: s.path })
      })
      expanded.subagents.forEach(s => {
        if (selected.has(keyOf('subagent', s.path))) jobs.push({ kind: 'subagent', name: s.name, path: s.path })
      })
      expanded.slashCommands.forEach(c => {
        if (selected.has(keyOf('slashCommand', c.path))) jobs.push({ kind: 'slashCommand', name: c.name, path: c.path })
      })

      for (const job of jobs) {
        try {
          const parsed = await window.api.agents.import.readTargetFromDisk(job.path, job.kind)
          parsed.origin = { plugin: expanded.name, pluginVersion: expanded.version, path: job.path }
          const result = await window.api.agents.import.importTarget(parsed, { folderId, onConflict: 'rename' })
          if ('syncWarning' in result && result.syncWarning) {
            failures.push({ name: job.name, error: `Synced with warning: ${result.syncWarning}` })
          }
        } catch (err) {
          // Isolate failures so one bad target doesn't abort the whole batch.
          failures.push({ name: job.name, error: (err as Error).message })
        }
      }
      if (failures.length > 0) {
        const msg = `Imported with ${failures.length} issue${failures.length === 1 ? '' : 's'}:\n\n`
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
      const index = await window.api.agents.import.discoverPluginInRepo(repoUrl)
      setRepoIndex(index)
      const all = new Set<SelectionKey>()
      index.skills.forEach(s        => all.add(keyOf('skill',        s.path)))
      index.subagents.forEach(s     => all.add(keyOf('subagent',     s.path)))
      index.slashCommands.forEach(c => all.add(keyOf('slashCommand', c.path)))
      setRepoSelected(all)
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

  const toggleRepo = (kind: ImportKind, p: string) => {
    setRepoSelected(prev => {
      const next = new Set(prev)
      const k = keyOf(kind, p)
      if (next.has(k)) next.delete(k)
      else next.add(k)
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

      type Job = { kind: ImportKind; name: string; path: string }
      const jobs: Job[] = []
      repoIndex.skills.forEach(s => {
        if (repoSelected.has(keyOf('skill', s.path))) jobs.push({ kind: 'skill', name: s.name, path: s.path })
      })
      repoIndex.subagents.forEach(s => {
        if (repoSelected.has(keyOf('subagent', s.path))) jobs.push({ kind: 'subagent', name: s.name, path: s.path })
      })
      repoIndex.slashCommands.forEach(c => {
        if (repoSelected.has(keyOf('slashCommand', c.path))) jobs.push({ kind: 'slashCommand', name: c.name, path: c.path })
      })

      for (const job of jobs) {
        try {
          const parsed = await window.api.agents.import.readTargetFromRepo(
            repoIndex.owner, repoIndex.name, repoIndex.branch, repoIndex.commitSha, job.path, job.kind,
          )
          const result = await window.api.agents.import.importTarget(parsed, { folderId, onConflict: 'rename' })
          if ('syncWarning' in result && result.syncWarning) {
            failures.push({ name: job.name, error: `Synced with warning: ${result.syncWarning}` })
          }
        } catch (err) {
          failures.push({ name: job.name, error: (err as Error).message })
        }
      }
      if (failures.length > 0) {
        const msg = `Imported with ${failures.length} issue${failures.length === 1 ? '' : 's'}:\n\n`
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
    <div className="import-skill-overlay" role="dialog" aria-label="Import plugin">
      <div className="import-skill-modal">
        <header className="import-skill-header">
          <h2>Import from plugin</h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="import-skill-subtitle">
          Imported sub-agents sync to <code>~/.claude/agents/</code>, slash commands to <code>~/.claude/commands/</code>. Skills stay in the library only.
        </p>
        <section className="import-skill-section">
          <div className="import-skill-section-label">Installed plugins</div>
          {plugins === null && <div className="import-skill-loading">Scanning…</div>}
          {plugins !== null && plugins.length === 0 && (
            <div className="import-skill-empty">No plugins found.</div>
          )}
          {plugins?.map(p => {
            const totalItems = p.skills.length + p.subagents.length + p.slashCommands.length
            return (
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
                    {totalItems} {totalItems === 1 ? 'item' : 'items'}
                  </span>
                </button>
                {expandedId === p.id && (
                  <div className="import-skill-plugin-skills">
                    {p.skills.length > 0 && (
                      <section className="import-skill-kind-group">
                        <header className="import-skill-kind-group-header">Skills ({p.skills.length})</header>
                        {p.skills.map(s => (
                          <label key={`skill:${s.path}`} className="import-skill-skill-row">
                            <input
                              type="checkbox"
                              checked={selected.has(keyOf('skill', s.path))}
                              onChange={() => toggle('skill', s.path)}
                            />
                            <KindBadge kind="skill" />
                            <span className="import-skill-skill-name">{s.name}</span>
                            {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                            <span className="import-skill-skill-meta">{s.fileCount} files</span>
                          </label>
                        ))}
                      </section>
                    )}

                    {p.subagents.length > 0 && (
                      <section className="import-skill-kind-group">
                        <header className="import-skill-kind-group-header">Sub-agents ({p.subagents.length})</header>
                        {p.subagents.map(s => (
                          <label key={`subagent:${s.path}`} className="import-skill-skill-row">
                            <input
                              type="checkbox"
                              checked={selected.has(keyOf('subagent', s.path))}
                              onChange={() => toggle('subagent', s.path)}
                            />
                            <KindBadge kind="subagent" />
                            {s.color && COLOR_MAP[s.color] && (
                              <span
                                className="import-skill-color-swatch"
                                style={{ backgroundColor: COLOR_MAP[s.color] }}
                                aria-hidden="true"
                              />
                            )}
                            <span className="import-skill-skill-name">{s.name}</span>
                            {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                          </label>
                        ))}
                      </section>
                    )}

                    {p.slashCommands.length > 0 && (
                      <section className="import-skill-kind-group">
                        <header className="import-skill-kind-group-header">Slash commands ({p.slashCommands.length})</header>
                        {p.slashCommands.map(c => (
                          <label key={`slashCommand:${c.path}`} className="import-skill-skill-row">
                            <input
                              type="checkbox"
                              checked={selected.has(keyOf('slashCommand', c.path))}
                              onChange={() => toggle('slashCommand', c.path)}
                            />
                            <KindBadge kind="slashCommand" />
                            <span className="import-skill-skill-name">{c.name}</span>
                            {c.description && <span className="import-skill-skill-desc">{c.description}</span>}
                            {c.argumentHint && <span className="import-skill-skill-meta">{c.argumentHint}</span>}
                          </label>
                        ))}
                      </section>
                    )}

                    <button
                      type="button"
                      className="import-skill-import-btn"
                      onClick={handleImport}
                      disabled={busy || repoImporting || selected.size === 0}
                    >
                      {busy ? 'Importing…' : `Import ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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
                  disabled={busy || repoFetching || repoImporting}
                />
                <button
                  type="button"
                  className="import-skill-github-fetch-btn"
                  onClick={handleFetchRepo}
                  disabled={busy || !repoUrlValid || repoFetching || repoImporting}
                >
                  {repoFetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {repoUrlError && <div className="import-skill-github-error">{repoUrlError}</div>}
              {repoFetchError && <div className="import-skill-github-error">{repoFetchError}</div>}
            </>
          )}

          {repoIndex !== null && (() => {
            const totalRepo = repoIndex.skills.length + repoIndex.subagents.length + repoIndex.slashCommands.length
            return (
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

                {totalRepo === 0 && (
                  <div className="import-skill-empty">
                    No skills, sub-agents, or slash commands found in this repo. Looked for <code>skills/&lt;name&gt;/SKILL.md</code>, <code>agents/*.md</code>, <code>commands/*.md</code>, and root <code>SKILL.md</code>.
                  </div>
                )}

                {repoIndex.skills.length > 0 && (
                  <section className="import-skill-kind-group">
                    <header className="import-skill-kind-group-header">Skills ({repoIndex.skills.length})</header>
                    {repoIndex.skills.map(s => (
                      <label key={`skill:${s.path}`} className="import-skill-skill-row">
                        <input
                          type="checkbox"
                          checked={repoSelected.has(keyOf('skill', s.path))}
                          onChange={() => toggleRepo('skill', s.path)}
                          disabled={repoImporting}
                        />
                        <KindBadge kind="skill" />
                        <span className="import-skill-skill-name">{s.name}</span>
                        {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                        <span className="import-skill-skill-meta">{s.fileCount} files</span>
                      </label>
                    ))}
                  </section>
                )}

                {repoIndex.subagents.length > 0 && (
                  <section className="import-skill-kind-group">
                    <header className="import-skill-kind-group-header">Sub-agents ({repoIndex.subagents.length})</header>
                    {repoIndex.subagents.map(s => (
                      <label key={`subagent:${s.path}`} className="import-skill-skill-row">
                        <input
                          type="checkbox"
                          checked={repoSelected.has(keyOf('subagent', s.path))}
                          onChange={() => toggleRepo('subagent', s.path)}
                          disabled={repoImporting}
                        />
                        <KindBadge kind="subagent" />
                        {s.color && COLOR_MAP[s.color] && (
                          <span
                            className="import-skill-color-swatch"
                            style={{ backgroundColor: COLOR_MAP[s.color] }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="import-skill-skill-name">{s.name}</span>
                        {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                      </label>
                    ))}
                  </section>
                )}

                {repoIndex.slashCommands.length > 0 && (
                  <section className="import-skill-kind-group">
                    <header className="import-skill-kind-group-header">Slash commands ({repoIndex.slashCommands.length})</header>
                    {repoIndex.slashCommands.map(c => (
                      <label key={`slashCommand:${c.path}`} className="import-skill-skill-row">
                        <input
                          type="checkbox"
                          checked={repoSelected.has(keyOf('slashCommand', c.path))}
                          onChange={() => toggleRepo('slashCommand', c.path)}
                          disabled={repoImporting}
                        />
                        <KindBadge kind="slashCommand" />
                        <span className="import-skill-skill-name">{c.name}</span>
                        {c.description && <span className="import-skill-skill-desc">{c.description}</span>}
                        {c.argumentHint && <span className="import-skill-skill-meta">{c.argumentHint}</span>}
                      </label>
                    ))}
                  </section>
                )}

                {totalRepo > 0 && (
                  <button
                    type="button"
                    className="import-skill-import-btn"
                    onClick={handleImportRepo}
                    disabled={busy || repoImporting || repoSelected.size === 0}
                  >
                    {repoImporting ? 'Importing…' : `Import ${repoSelected.size} ${repoSelected.size === 1 ? 'item' : 'items'}`}
                  </button>
                )}
              </div>
            )
          })()}
        </section>
      </div>
    </div>
  )
}
