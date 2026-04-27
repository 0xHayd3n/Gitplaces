import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { MemoryRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useTooltip } from './hooks/useTooltip'
import { SavedReposProvider } from './contexts/SavedRepos'
import { ProfileOverlayProvider, useProfileOverlay } from './contexts/ProfileOverlay'
import { SearchProvider } from './contexts/Search'
import { ToastProvider } from './contexts/Toast'
import { RepoNavProvider } from './contexts/RepoNav'
import { AppearanceProvider, useAppearance } from './contexts/Appearance'
import { GitHubAuthProvider } from './contexts/GitHubAuth'
import ProfileOverlay from './components/ProfileOverlay'
import Titlebar from './components/Titlebar'
import Dock from './components/Dock'
import AppLoadingFallback from './components/AppLoadingFallback'
import RequireGitHub from './components/RequireGitHub'

const AiDialogue = lazy(() => import('./components/AiDialogue'))

const Discover = lazy(() => import('./views/Discover'))
const Library = lazy(() => import('./views/Library'))
const Starred = lazy(() => import('./views/Starred'))
const Profile = lazy(() => import('./views/Profile'))
const RepoDetail = lazy(() => import('./views/RepoDetail'))
const Onboarding = lazy(() => import('./views/Onboarding'))
const Settings = lazy(() => import('./views/Settings'))
const Create = lazy(() => import('./views/Create'))
const LocalProjectDetail = lazy(() => import('./views/LocalProjectDetail'))

function ProfileOverlayPortal() {
  const { profileState } = useProfileOverlay()
  if (!profileState.isOpen) return null
  return <ProfileOverlay />
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { background } = useAppearance()
  const [aiOpen, setAiOpen] = useState(false)
  const { text: tooltipText, nodeRef: tooltipRef } = useTooltip()
  const isDiscoverPage = location.pathname === '/' || location.pathname.startsWith('/discover') || location.pathname.startsWith('/library') || location.pathname.startsWith('/repo/') || location.pathname.startsWith('/create')

  const toggleAi = useCallback(() => setAiOpen(o => !o), [])
  const closeAi = useCallback(() => setAiOpen(false), [])

  useEffect(() => {
    window.api.settings.get('onboarding_complete').then((val) => {
      if (val !== '1') {
        navigate('/onboarding')
      } else {
        window.api.github.getStarred().catch(() => {})
      }
    }).catch(() => {
      navigate('/onboarding')
    })
  }, [navigate])

  return (
    <div className={`app-shell${background === 'dither' ? ' app-shell--dither' : ''}`}>
      <div className={`app-main-column${isDiscoverPage ? ' titlebar-overlay' : ''}`}>
        <Titlebar />
        <main className={`main-content${aiOpen ? ' ai-dialogue-tilt' : ''}`}>
          <Suspense fallback={<AppLoadingFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/library" replace />} />
              <Route path="/discover" element={<RequireGitHub><Discover /></RequireGitHub>} />
              <Route path="/library/*" element={<RequireGitHub><Library /></RequireGitHub>} />
              <Route path="/collections" element={<Navigate to="/library" replace />} />
              <Route path="/local-project" element={<LocalProjectDetail />} />
              <Route path="/create" element={<Create />} />
              <Route path="/create/:sessionId" element={<Create />} />
              <Route path="/starred" element={<RequireGitHub><Starred /></RequireGitHub>} />
              <Route path="/profile" element={<RequireGitHub><Profile /></RequireGitHub>} />
              <Route path="/repo/:owner/:name" element={<RequireGitHub><RepoDetail /></RequireGitHub>} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
          <ProfileOverlayPortal />
        </main>
      </div>
      <Dock onAiClick={toggleAi} aiOpen={aiOpen} />
      {aiOpen && (
        <Suspense fallback={null}>
          <AiDialogue open={aiOpen} onClose={closeAi} />
        </Suspense>
      )}
      {createPortal(
        <div ref={tooltipRef} className="app-tooltip" style={{ opacity: tooltipText ? 1 : 0 }}>{tooltipText}</div>,
        document.body,
      )}
    </div>
  )
}

export default function App() {
  return (
    <MemoryRouter
      initialEntries={['/discover']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppearanceProvider>
        <GitHubAuthProvider>
          <ProfileOverlayProvider>
            <SavedReposProvider>
              <SearchProvider>
                <ToastProvider>
                  <RepoNavProvider>
                    <AppContent />
                  </RepoNavProvider>
                </ToastProvider>
              </SearchProvider>
            </SavedReposProvider>
          </ProfileOverlayProvider>
        </GitHubAuthProvider>
      </AppearanceProvider>
    </MemoryRouter>
  )
}
