import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CreateTemplate } from '../../types/create'
import type { Repo, SavedRepo } from '../../types/repo'
import type { LocalProject } from '../../types/library'
import RepoCard from '../RepoCard'
import { useArchivedRepos } from '../../hooks/useArchivedRepos'
import { recordRecentVisit } from '../../lib/recentVisits'


// ── Lift a normalized Repo (from window.api.github.getMyRepos) into a
//    full SavedRepo so it can be passed to <RepoCard /> (which expects
//    the library-extras shape). SavedRepo's extras are all nullable. ──

function repoToSavedRepo(r: Repo): SavedRepo {
  return {
    ...r,
    savedAt: null,
    starredAt: null,
    unstarredAt: null,
    discoveredAt: null,
    discoverQuery: null,
    bannerSvg: null,
    bannerColor: null,
    ogImageUrl: null,
    type: null,
    typeBucket: null,
    typeSub: null,
    translatedDescription: null,
    translatedDescriptionLang: null,
    translatedReadme: null,
    translatedReadmeLang: null,
    detectedLanguage: null,
    verificationScore: null,
    verificationTier: null,
    verificationSignals: null,
    verificationCheckedAt: null,
    isForked: null,
    updateAvailable: null,
    updateCheckedAt: null,
    upstreamVersion: null,
    storedVersion: null,
    archivedAt: null,
    forkedAt: null,
    fetchedAt: null,
    starredCheckedAt: null,
    storybookUrl: null,
  }
}

// ── Local project ─────────────────────────────────────────────────

function makeStubRow(p: LocalProject): SavedRepo {
  const owner = p.owner ?? ''
  const name = p.name
  const fullName = owner ? `${owner}/${name}` : name
  return repoToSavedRepo({
    hostId: 'gh:api.github.com',
    hostType: 'github',
    hostNativeId: `local:${p.path}`,
    fullName,
    owner,
    name,
    htmlUrl: owner ? `https://github.com/${owner}/${name}` : '',
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: '',
    updatedAt: '',
    pushedAt: '',
    ownerAvatarUrl: '',
  })
}

// ── Type shortcut icons ───────────────────────────────────────────

function McpIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 6h16v2H4V6zm2 4h12v2H6v-2zm-2 4h16v2H4v-2zm2 4h12v2H6v-2z"/>
    </svg>
  )
}

function WebIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>
  )
}

function CliIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10.5l1.5-1.5L11 12l-3.5 3L6 13.5 8.5 12 6 10.5zm5 4.5h6v-2h-6v2z"/>
    </svg>
  )
}

function WidgetIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm5 13h-3v-3h-2v3h-3v2h3v3h2v-3h3v-2z"/>
    </svg>
  )
}

function BlankIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
    </svg>
  )
}

const TYPE_SHORTCUTS = [
  { id: 'mcp',    label: 'MCP Server',     icon: <McpIcon />,    gradient: ['#1a3a4a', '#0d6e8a'] },
  { id: 'webapp', label: 'Web App',         icon: <WebIcon />,    gradient: ['#2a1a4a', '#6e0d8a'] },
  { id: 'cli',    label: 'CLI Tool',        icon: <CliIcon />,    gradient: ['#1a3a1a', '#0d8a2e'] },
  { id: 'widget', label: 'Desktop Widget',  icon: <WidgetIcon />, gradient: ['#3a2a1a', '#8a4e0d'] },
  { id: 'blank',  label: 'Blank Project',   icon: <BlankIcon />,  gradient: ['#2a2a2a', '#444444'] },
]

const TYPE_LABELS: Record<string, string> = {
  mcp: 'MCP Server', webapp: 'Web App', cli: 'CLI Tool', widget: 'Desktop Widget', blank: 'Blank',
}

// ── Component ─────────────────────────────────────────────────────

export interface ProjectEntry {
  row: SavedRepo
  isLocal: boolean
  isGitRepo: boolean
  localPath: string | null
  hasGithub: boolean
}

const DEFAULT_COLS = 6

export default function TemplateGallery() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<CreateTemplate[]>([])
  const [githubRepos, setGithubRepos] = useState<SavedRepo[]>([])
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState(DEFAULT_COLS)
  const [colsOpen, setColsOpen] = useState(false)
  const { archivedSet } = useArchivedRepos()

  useEffect(() => {
    window.api.create.getTemplates().then(setTemplates).catch(() => {})
    window.api.github.getMyRepos()
      .then((raw: Repo[]) => setGithubRepos(raw.map(repoToSavedRepo)))
      .catch(() => {})
      .finally(() => setLoading(false))
    window.api.settings.get('projectsFolder').then(folder => {
      if (folder) {
        window.api.projects?.scanFolder(folder).then(setLocalProjects).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  async function startType(toolType: string) {
    const tmpl = templates.find(t => t.toolType === toolType) ?? templates[0]
    if (!tmpl) return
    const session = await window.api.create.startSession({
      templateId: tmpl.id,
      toolType: tmpl.toolType,
      name: toolType === 'blank' ? 'Untitled Project' : TYPE_LABELS[toolType] ?? toolType,
    })
    navigate(`/create/${session.id}`)
  }

  // ── Merge: local takes precedence over GitHub ─────────────────────

  const allEntries = useMemo<ProjectEntry[]>(() => {
    const localKeySet = new Set(
      localProjects
        .filter(p => p.owner && p.repoName)
        .map(p => `${p.owner}/${p.repoName}`)
    )
    const localEntries = localProjects.map(p => {
      const ghMatch = p.owner && p.repoName
        ? githubRepos.find(r => r.owner === p.owner && r.name === p.repoName)
        : undefined
      return {
        row: ghMatch ?? makeStubRow(p),
        isLocal: true,
        isGitRepo: p.isGit,
        localPath: p.path,
        hasGithub: !!ghMatch || !!(p.owner && p.repoName),
      }
    })
    const githubOnlyEntries = githubRepos
      .filter(r => !localKeySet.has(`${r.owner}/${r.name}`))
      .map(r => ({ row: r, isLocal: false, isGitRepo: false, localPath: null, hasGithub: true }))
    return [...localEntries, ...githubOnlyEntries]
  }, [localProjects, githubRepos])

  const visibleEntries = useMemo(
    () => allEntries.filter(({ row }) => !archivedSet.has(`${row.owner}/${row.name}`)),
    [allEntries, archivedSet]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return visibleEntries.filter(({ row }) =>
      !q ||
      row.name.toLowerCase().includes(q) ||
      (row.description ?? '').toLowerCase().includes(q) ||
      row.owner.toLowerCase().includes(q)
    )
  }, [visibleEntries, search])

  return (
    <div className="projects-shell">
      <div className="projects-gallery">
      <div className="discover-drag-strip" aria-hidden="true" />
      {/* Hero */}
      <div className="projects-hero">
        <h1 className="projects-hero-title">What will you build today?</h1>
        <div className="projects-search-wrap">
          <svg className="projects-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM9.5 14A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z"/>
          </svg>
          <input
            className="projects-search"
            placeholder="Search your repositories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="projects-type-row">
          {TYPE_SHORTCUTS.map(({ id, label, icon, gradient }) => (
            <button key={id} className="projects-type-btn" onClick={() => startType(id)} title={`New ${label}`}>
              <div className="projects-type-icon" style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}>
                {icon}
              </div>
              <span className="projects-type-label">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Unified grid */}
      <div className="projects-repos-section">
        <div className="projects-repos-header">
          <span className="projects-repos-count">
            {loading ? '' : `${filtered.length} ${filtered.length === 1 ? 'project' : 'projects'}`}
          </span>
          <div className="projects-cols-wrap">
            <button
              className={`projects-cols-btn${colsOpen ? ' active' : ''}`}
              onClick={() => setColsOpen(o => !o)}
              title="Grid columns"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h4v18H3V3zm7 0h4v18h-4V3zm7 0h4v18h-4V3z"/>
              </svg>
              <span>{cols}</span>
            </button>
            {colsOpen && (
              <div className="projects-cols-popover">
                {[4, 5, 6, 7, 8].map(n => (
                  <button
                    key={n}
                    className={`projects-cols-opt${cols === n ? ' active' : ''}`}
                    onClick={() => { setCols(n); setColsOpen(false) }}
                  >{n}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="discover-grid" data-cols={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols * 2 }).map((_, i) => (
              <div key={i} className="repo-card-skeleton">
                <div className="repo-card-skeleton-dither shimmer" />
                <div className="repo-card-skeleton-info">
                  <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 4 }} />
                  <div className="shimmer" style={{ width: '80%', height: 8, borderRadius: 4, marginTop: 6 }} />
                  <div className="shimmer" style={{ width: '40%', height: 8, borderRadius: 4, marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="projects-empty">
            {search ? `No projects matching "${search}"` : 'No projects found'}
          </div>
        ) : (
          <div className="discover-grid" data-cols={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {filtered.map(({ row, isLocal, isGitRepo, localPath, hasGithub }) => (
              <div key={`${row.owner}/${row.name}`} className={`projects-card-wrap${isLocal ? ' is-local' : ''}`}>
                {isLocal && <span className="projects-local-pill">Local</span>}
                <RepoCard
                  repo={row}
                  onNavigate={path => {
                    const actualPath = !hasGithub && localPath
                      ? `/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`
                      : path
                    recordRecentVisit({ owner: row.owner, name: row.name, ownerAvatarUrl: row.ownerAvatarUrl, navigatePath: actualPath })
                    navigate(actualPath)
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
