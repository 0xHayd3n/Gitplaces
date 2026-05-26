import { useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import NavBar from './NavBar'

// ── Nav icons (20×20, filled) ────────────────────────────────────

function DiscoverIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.5 2A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22H20V2H6.5z" />
      <rect x="9" y="7" width="7" height="1.5" rx=".75" fill="rgba(0,0,0,0.35)" />
    </svg>
  )
}

function StarredIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
    </svg>
  )
}


function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 15.6 12 3.6 3.6 0 0 1 12 15.6z" />
    </svg>
  )
}

function CreateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  )
}

function AiIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  )
}

// ── Nav items config ──────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Discover', path: '/discover', icon: <DiscoverIcon /> },
  { label: 'Projects', path: '/create',   icon: <CreateIcon /> },
  { label: 'Library',  path: '/library',  icon: <LibraryIcon /> },
  { label: 'Profile',  path: '/profile',  icon: <ProfileIcon /> },
]

// ── Helpers ───────────────────────────────────────────────────────


function isActive(currentPath: string, itemPath: string): boolean {
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

// Map a pathname to its owning tab prefix (so /repo/* counts as /discover)
function getTabPrefix(pathname: string): string | null {
  if (pathname.startsWith('/discover') || pathname.startsWith('/repo/')) return '/discover'
  if (pathname.startsWith('/library'))     return '/library'
  if (pathname.startsWith('/create'))      return '/create'
  if (pathname.startsWith('/profile'))     return '/profile'
  if (pathname.startsWith('/settings'))    return '/settings'
  return null
}

// ── Component ─────────────────────────────────────────────────────

interface DockProps {
  onAiClick: () => void
  aiOpen?: boolean
}

export default function Dock({ onAiClick, aiOpen }: DockProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const lastTabPath = useRef<Record<string, string>>({})
  const isOnboarding = location.pathname === '/onboarding'

  // Keep last visited path per tab so dock clicks restore previous position.
  useEffect(() => {
    const prefix = getTabPrefix(location.pathname)
    if (prefix) lastTabPath.current[prefix] = location.pathname
  }, [location.pathname])

  const handleNavClick = useCallback((tabPath: string) => {
    const saved = lastTabPath.current[tabPath] ?? tabPath
    if (saved !== tabPath) {
      // Push the tab root first so the back button has a valid parent entry,
      // then push the saved sub-path. React 18 batches both before rendering.
      navigate(tabPath)
      navigate(saved)
    } else {
      navigate(saved)
    }
  }, [navigate])

  if (isOnboarding) return null

  return (
    <>
      <nav className={`floating-dock${aiOpen ? ' ai-hidden' : ''}`} role="navigation" aria-label="Main navigation">
        {/* TTS playback bar portals in here when active; collapses when empty */}
        <div id="tts-dock-slot" />

        {/* Breadcrumb + back arrow (relocated here from the top window
            drag strip per UX choice). Sits as its own row above the
            dock icons. NavBar renders nothing on routes without a
            meaningful breadcrumb, so the slot collapses on those. */}
        <div className="dock-navbar-slot">
          <NavBar />
        </div>

        <div className="dock-items-row">
          {/* Nav items */}
          {NAV_ITEMS.map(({ label, path, icon }) => (
            <button
              key={path}
              type="button"
              className={`dock-item${isActive(location.pathname, path) ? ' dock-item-active' : ''}`}
              onClick={() => handleNavClick(path)}
              aria-label={label}
              title={label}
            >
              {icon}
            </button>
          ))}

          <span className="dock-divider" aria-hidden="true" />

          {/* Settings */}
          <button
            type="button"
            className={`dock-item${location.pathname === '/settings' ? ' dock-item-active' : ''}`}
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>

          {/* AI */}
          <button
            type="button"
            className={`dock-item dock-item-ai${aiOpen ? ' open' : ''}`}
            onClick={onAiClick}
            aria-label="AI Assistant"
            title="AI Assistant"
          >
            <AiIcon />
          </button>
        </div>
      </nav>
    </>
  )
}
