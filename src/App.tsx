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
import { LearningProgressProvider } from './contexts/LearningProgressContext'
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
const RepoOverlay = lazy(() => import('./components/RepoOverlay'))

function ProfileOverlayPortal() {
  const { profileState } = useProfileOverlay()
  if (!profileState.isOpen) return null
  return <ProfileOverlay />
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const backgroundLocation = (location.state as { background?: typeof location } | null)?.background
  const pageKey = (backgroundLocation ?? location).pathname.split('/')[1] || 'root'
  const { background } = useAppearance()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMounted, setAiMounted] = useState(false)
  const { nodeRef: tooltipRef } = useTooltip()
  const isDiscoverPage = location.pathname === '/' || location.pathname.startsWith('/discover') || location.pathname.startsWith('/library') || location.pathname.startsWith('/repo/') || location.pathname.startsWith('/create')

  const toggleAi = useCallback(() => {
    setAiMounted(true)
    setAiOpen(o => !o)
  }, [])
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

  // Preload sibling page chunks on idle so first navigation to each tab is
  // instant — no chunk fetch + parse + execute on click.
  useEffect(() => {
    const handle = window.requestIdleCallback(() => {
      void import('./views/Discover')
      void import('./views/Library')
      void import('./views/Starred')
      void import('./views/Profile')
      void import('./views/Create')
      void import('./views/RepoDetail')
      void import('./views/Settings')
      void import('./views/LocalProjectDetail')
      void import('./components/RepoOverlay')
      void import('./components/AiDialogue')
    }, { timeout: 8000 })
    return () => window.cancelIdleCallback(handle)
  }, [])

  return (
    <div className={`app-shell${background === 'dither' ? ' app-shell--dither' : ''}`}>
      <div className={`app-main-column${isDiscoverPage ? ' titlebar-overlay' : ''}`}>
        <Titlebar />
        <main className={`main-content${aiOpen ? ' ai-dialogue-tilt' : ''}`}>
          <Suspense fallback={<AppLoadingFallback />}>
            <div key={pageKey} className="page-transition">
              <Routes location={backgroundLocation ?? location}>
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
            </div>
            {backgroundLocation && (
              <Routes>
                <Route path="/repo/:owner/:name" element={<RequireGitHub><RepoOverlay /></RequireGitHub>} />
              </Routes>
            )}
          </Suspense>
          <ProfileOverlayPortal />
        </main>
      </div>
      {!location.pathname.startsWith('/settings') && (
        <Dock onAiClick={toggleAi} aiOpen={aiOpen} />
      )}
      {aiMounted && (
        <Suspense fallback={null}>
          <AiDialogue open={aiOpen} onClose={closeAi} />
        </Suspense>
      )}
      {createPortal(
        <div ref={tooltipRef} className="app-tooltip" />,
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
                    <LearningProgressProvider>
                      <AppContent />
                    </LearningProgressProvider>
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
