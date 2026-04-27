import { useLocation, useNavigate } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { Folder, ChevronRight } from 'lucide-react'
import { useRepoNav } from '../contexts/RepoNav'
import FileIcon from './FileIcon'
import logoSrc from '../assets/logo.png'
import { VIEW_MODES, type ViewModeKey } from '../lib/discoverQueries'
import { VIEW_MODE_ICONS } from './ViewModeIcons'
import { useWhitewashAvatar } from '../hooks/useWhitewashAvatar'


function DiscoverBreadcrumbIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ marginRight: 3, flexShrink: 0 }}>
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8.8" y1="8.8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const ROUTE_LABELS: Record<string, string> = {
  '/library':  'My Library',
  '/starred':  'Starred',
  '/settings': 'Settings',
}

const TAB_LABELS: Record<string, string> = {
  readme: 'README',
  files: 'Files',
  skill: 'Skills Folder',
  releases: 'Releases',
  related: 'Related',
  videos: 'Videos',
  posts: 'Posts',
  commands: 'Commands',
  components: 'Components',
}

interface Segment {
  label: string
  onClick?: () => void
  icon?: React.ReactNode
}

export default function NavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { state: nav } = useRepoNav()
  const path     = location.pathname
  const [searchParams] = useSearchParams()

  const isRepo = path.startsWith('/repo/')
  const repoAvatarUrl = isRepo ? (location.state as any)?.repoAvatarUrl as string | null : null
  const whitewashSrc = useWhitewashAvatar(repoAvatarUrl)

  // Build breadcrumb segments
  const segments: Segment[] = []

  const repoAvatarIcon = whitewashSrc
    ? <img src={whitewashSrc} alt="" style={{ width: 12, height: 12, borderRadius: 2, marginRight: 3, flexShrink: 0 }} />
    : null

  if (isRepo) {
    const parts = path.split('/')
    const repoName = parts[3] || ''

    const fromDiscoverView = (location.state as any)?.fromDiscoverView as ViewModeKey | undefined
    if (fromDiscoverView) {
      const vm = VIEW_MODES.find(m => m.key === fromDiscoverView)
      const Icon = VIEW_MODE_ICONS[fromDiscoverView]
      segments.push({ label: 'Discover', onClick: () => navigate(`/discover?view=${fromDiscoverView}`) })
      if (vm) {
        segments.push({
          label: vm.label,
          onClick: () => navigate(`/discover?view=${fromDiscoverView}`),
        })
      }
    } else {
      segments.push({ label: 'Discover', onClick: () => navigate('/discover') })
    }

    if (repoName) {
      if (nav.activeTab && nav.activeTab !== 'readme') {
        segments.push({
          label: repoName,
          icon: repoAvatarIcon,
          onClick: () => nav.onTabClick?.('readme'),
        })
      } else {
        segments.push({ label: repoName, icon: repoAvatarIcon })
      }
    }

    if (nav.activeTab && nav.activeTab !== 'readme') {
      const tabLabel = TAB_LABELS[nav.activeTab] || nav.activeTab

      if (nav.activeTab === 'files' && nav.filePath !== null) {
        segments.push({
          label: tabLabel,
          onClick: () => nav.onFilePathClick?.(''),
        })

        if (nav.filePath === '') {
          segments.push({
            label: 'root',
            icon: <Folder size={12} style={{ color: 'var(--accent)', marginRight: 3 }} />,
          })
        } else {
          segments.push({
            label: 'root',
            onClick: () => nav.onFilePathClick?.(''),
          })

          const fileParts = nav.filePath.split('/')
          fileParts.forEach((part, i) => {
            const isLast = i === fileParts.length - 1
            if (isLast) {
              const icon = nav.isDirectory
                ? <Folder size={12} style={{ color: 'var(--accent)', marginRight: 3 }} />
                : <FileIcon filename={part} size={12} className="app-navbar-url-fileicon" />
              segments.push({ label: part, icon })
            } else {
              const partialPath = fileParts.slice(0, i + 1).join('/')
              segments.push({
                label: part,
                onClick: () => nav.onFilePathClick?.(partialPath),
              })
            }
          })
        }
      } else {
        segments.push({ label: tabLabel })
      }
    }
  } else if (path.startsWith('/discover')) {
    const v = searchParams.get('view')
    const viewMode: ViewModeKey | null = (v === 'recommended' || v === 'all') ? v : null

    segments.push({ label: 'Discover', icon: <DiscoverBreadcrumbIcon />, onClick: () => navigate('/discover') })
    if (viewMode) {
      const vm = VIEW_MODES.find(m => m.key === viewMode)!
      const Icon = VIEW_MODE_ICONS[viewMode]
      segments.push({
        label: vm.label,
        icon: <Icon size={12} />,
      })
    }
  } else if (path.startsWith('/library/collection/')) {
    const collectionName = (location.state as any)?.collectionName as string | undefined
    segments.push({ label: 'Library', onClick: () => navigate('/library') })
    segments.push({ label: collectionName ?? 'Collection' })
  } else {
    const label = ROUTE_LABELS[path]
    if (label) segments.push({ label })
  }

  const inFilesTab = isRepo && nav.activeTab === 'files' && nav.filePath !== null

  function handleBack() {
    if (inFilesTab && nav.canGoBack && nav.onGoBack) { nav.onGoBack(); return }
    navigate(-1)
  }

  return (
    <div className="app-navbar">
      <div className="app-navbar-controls">
        <button
          className="app-navbar-btn"
          onClick={handleBack}
          disabled={false}
          aria-label="Go back"
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </button>
      </div>
      <div className="app-navbar-url">
        <img src={logoSrc} alt="" className="app-navbar-url-favicon" />
        <span className="app-navbar-url-text">
          <span className="app-navbar-url-base">Git Suite</span>
          {segments.map((seg, i) => (
            <span key={i}>
              <ChevronRight size={12} className="app-navbar-url-sep-icon" aria-hidden="true" />
              {seg.onClick ? (
                <button className="app-navbar-url-segment" onClick={seg.onClick}>{seg.icon}{seg.label}</button>
              ) : (
                <span className="app-navbar-url-current">
                  {seg.icon}{seg.label}
                </span>
              )}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
