import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useGitHubLogin } from '../hooks/useGitHubLogin'

// ── Background SVG for Screen 0 ─────────────────────────────────
function BackgroundSVG() {
  return (
    <svg
      className="onboarding-bg"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#f5f0ff" />
          <stop offset="100%" stopColor="#faf9ff" />
        </radialGradient>
      </defs>
      <rect width="800" height="500" fill="url(#bg-grad)" />
      {/* Connecting lines */}
      <g stroke="rgba(109,40,217,0.12)" strokeWidth="1">
        <line x1="160" y1="120" x2="320" y2="200" />
        <line x1="320" y1="200" x2="480" y2="140" />
        <line x1="480" y1="140" x2="640" y2="220" />
        <line x1="320" y1="200" x2="400" y2="320" />
        <line x1="400" y1="320" x2="540" y2="360" />
        <line x1="160" y1="120" x2="240" y2="300" />
        <line x1="640" y1="220" x2="680" y2="340" />
      </g>
      {/* Nodes */}
      <g fill="rgba(109,40,217,0.2)">
        <circle cx="160" cy="120" r="4" />
        <circle cx="320" cy="200" r="5" />
        <circle cx="480" cy="140" r="4" />
        <circle cx="640" cy="220" r="4" />
        <circle cx="400" cy="320" r="5" />
        <circle cx="540" cy="360" r="3" />
        <circle cx="240" cy="300" r="4" />
        <circle cx="680" cy="340" r="3" />
      </g>
      {/* Faint repo names */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="11" fill="rgba(109,40,217,0.18)">
        <text x="60" y="440">vercel/next.js</text>
        <text x="220" y="440">microsoft/vscode</text>
        <text x="440" y="440">facebook/react</text>
        <text x="620" y="440">rust-lang/rust</text>
        <text x="80" y="460">torvalds/linux</text>
        <text x="280" y="460">openai/openai-python</text>
        <text x="530" y="460">golang/go</text>
      </g>
    </svg>
  )
}

// ── Progress dots ────────────────────────────────────────────────
function ProgressDots({ active }: { active: 0 | 1 }) {
  return (
    <div className="onboarding-dots" data-testid="progress-dots">
      <span className={`onboarding-dot${active === 0 ? ' active' : ''}`} />
      <span className={`onboarding-dot${active === 1 ? ' active' : ''}`} />
    </div>
  )
}

// ── Screen 0 — Welcome ───────────────────────────────────────────
function WelcomeScreen({ onConnect, onSkip }: { onConnect: () => void; onSkip: () => void }) {
  return (
    <div className="onboarding-root" data-testid="onboarding-screen-0">
      <BackgroundSVG />
      <div className="onboarding-welcome-content">
        <span className="onboarding-pill">Git Suite</span>
        <h1 className="onboarding-headline">
          Turn any GitHub repo into an{' '}
          <span className="onboarding-headline-accent">AI skill.</span>
        </h1>
        <p className="onboarding-sub">
          Browse repos, install skills locally, and your AI agent understands your entire
          stack — without you having to explain it every time.
        </p>
        <button className="onboarding-btn-primary" onClick={onConnect}>
          Connect GitHub →
        </button>
        <button className="onboarding-btn-skip" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Screen 1 — Connect GitHub ────────────────────────────────────
type ConnectState = 'idle' | 'awaiting' | 'connected'

function ConnectScreen({
  onBack,
  onContinue,
}: {
  onBack: () => void
  onContinue: () => void
}) {
  const auth = useGitHubAuth()
  const login = useGitHubLogin()
  const [copied, setCopied] = useState(false)

  const userCode = login.userCode
  const verificationUri = login.verificationUri
  const verificationUriComplete = login.verificationUriComplete
  const connectedUser = auth.user?.login ?? null
  const connectState: ConnectState =
    auth.status === 'connected' ? 'connected'
    : login.status === 'pending' || login.status === 'polling' ? 'awaiting'
    : 'idle'
  const errorMsg = login.error

  async function handleConnect() {
    setCopied(false)
    await login.start()
  }

  async function handleCopyCode() {
    if (!userCode) return
    try {
      await navigator.clipboard.writeText(userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be blocked; fall back silently
    }
  }

  function handleOpenVerification() {
    const url = verificationUriComplete ?? verificationUri
    if (url) window.api.github.openLoginPopup(url).catch(() => {})
  }

  const btnLabel =
    connectState === 'idle' ? 'Connect'
    : connectState === 'awaiting' ? 'Waiting on GitHub…'
    : '✓ Connected'

  return (
    <div className="onboarding-root" data-testid="onboarding-screen-1">
      <ProgressDots active={0} />
      <div className="onboarding-card-layout">
        <p className="onboarding-step-label">Step 1 of 2</p>
        <h2 className="onboarding-card-heading">Connect GitHub</h2>
        <p className="onboarding-card-body">
          Git Suite uses GitHub to let you browse repos and sync the ones you already know.
          It never writes to GitHub or accesses private repos.
        </p>

        <div className="permission-card">
          <div className="permission-card-header">
            {/* GitHub icon */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--t2)' }}>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
                1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
                1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
                1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="permission-card-title">GitHub</span>
            <button
              className={`connect-btn${connectState === 'connected' ? ' connected' : ''}`}
              onClick={handleConnect}
              disabled={connectState === 'awaiting' || connectState === 'connected'}
            >
              {btnLabel}
            </button>
          </div>
          <p className={`permission-card-sub${connectState === 'connected' ? ' connected' : ''}`}>
            {connectState === 'connected' && connectedUser
              ? `@${connectedUser}`
              : errorMsg
              ? errorMsg
              : connectState === 'awaiting' && userCode
              ? 'Enter this code on GitHub to approve'
              : 'Not connected'}
          </p>

          {connectState === 'awaiting' && userCode && (
            <div className="device-code-box">
              <div className="device-code-value" aria-label="One-time code">
                {userCode}
              </div>
              <div className="device-code-actions">
                <button type="button" className="device-code-btn" onClick={handleCopyCode}>
                  {copied ? 'Copied ✓' : 'Copy code'}
                </button>
                <button type="button" className="device-code-btn" onClick={handleOpenVerification}>
                  Open GitHub
                </button>
              </div>
            </div>
          )}
          <div className="permission-divider" />
          <div className="permission-row">
            <span className="permission-badge">★</span>
            Read &amp; sync starred repositories
          </div>
          <div className="permission-row">
            <span className="permission-badge">◎</span>
            Read public profile
          </div>
          <div className="permission-row">
            <span className="permission-badge">+</span>
            Star / unstar public repositories
          </div>
        </div>

        <div className="onboarding-nav">
          <button className="onboarding-btn-back" onClick={onBack}>← Back</button>
          <button
            className="onboarding-btn-continue"
            onClick={onContinue}
            disabled={connectState !== 'connected'}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Screen 2 — Done ──────────────────────────────────────────────
function DoneScreen() {
  const navigate = useNavigate()
  const [repoCount, setRepoCount] = useState('…')

  useEffect(() => {
    async function syncAndLoad() {
      await window.api.github.getStarred().catch(() => {})
      const val = await window.api.settings.get('starred_repo_count').catch(() => null)
      setRepoCount(val ?? '0')
    }
    syncAndLoad()
  }, [])

  async function handleOpen() {
    await window.api.settings.set('onboarding_complete', '1')
    window.api.github.getStarred().catch(() => {})
    navigate('/discover')
  }

  return (
    <div className="onboarding-root" data-testid="onboarding-screen-2">
      <ProgressDots active={1} />
      <div className="onboarding-card-layout">
        <div className="onboarding-check-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M4 10l4.5 4.5L16 6"
              stroke="#059669"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="onboarding-card-heading">Ready to go</h2>
        <p className="onboarding-card-body">
          GitHub is connected. Browse Discover to find repos, or head to Starred to install
          skills from ones you already know.
        </p>

        <div className="onboarding-stat-row">
          <div className="onboarding-stat-card">
            <span className="onboarding-stat-value">{repoCount}</span>
            <span className="onboarding-stat-label">Repos synced</span>
          </div>
          <div className="onboarding-stat-card">
            <span className="onboarding-stat-value">0</span>
            <span className="onboarding-stat-label">Skills installed</span>
          </div>
          <div className="onboarding-stat-card">
            <span className="onboarding-stat-value">Ready</span>
            <span className="onboarding-stat-label">Status</span>
          </div>
        </div>

        <div className="onboarding-tip-box">
          <span className="onboarding-tip-label">HOW IT WORKS</span>
          <p className="onboarding-tip-text">
            Find any repo → hit + Install → Git Suite generates a skill file and injects it
            into Claude automatically. Your AI now knows that repo.
          </p>
        </div>

        <button className="onboarding-btn-open" onClick={handleOpen}>
          Open Git Suite →
        </button>
      </div>
    </div>
  )
}

// ── Root component ───────────────────────────────────────────────
export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1 | 2>(0)

  async function handleSkip() {
    await window.api.settings.set('onboarding_complete', '1')
    navigate('/discover')
  }

  if (step === 0)
    return <WelcomeScreen onConnect={() => setStep(1)} onSkip={handleSkip} />
  if (step === 1)
    return <ConnectScreen onBack={() => setStep(0)} onContinue={() => setStep(2)} />
  return <DoneScreen />
}
