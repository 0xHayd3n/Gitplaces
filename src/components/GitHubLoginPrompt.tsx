import { useState } from 'react'
import { useGitHubLogin } from '../hooks/useGitHubLogin'
import './GitHubLoginPrompt.css'

export default function GitHubLoginPrompt() {
  const { status, userCode, verificationUri, verificationUriComplete, error, start, cancel } = useGitHubLogin()
  const [copied, setCopied] = useState(false)

  const isWaiting = status === 'pending' || status === 'polling'

  async function handleCopy() {
    if (!userCode) return
    try {
      await navigator.clipboard.writeText(userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be blocked
    }
  }

  function handleOpen() {
    const url = verificationUriComplete ?? verificationUri
    if (url) window.api.github.openLoginPopup(url).catch(() => {})
  }

  return (
    <div className="gh-login-prompt">
      <div className="gh-login-card">
        <svg className="gh-login-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
            -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
            .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
            -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
            1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
            1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
            1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>

        <h2 className="gh-login-heading">Connect to GitHub</h2>
        <p className="gh-login-sub">
          Sign in to browse, save, and manage your repositories.
        </p>

        {!isWaiting && (
          <button
            type="button"
            className="gh-login-btn"
            onClick={start}
            disabled={status === 'success'}
          >
            {status === 'error' ? 'Try again' : 'Log in to GitHub'}
          </button>
        )}

        {isWaiting && userCode && (
          <>
            <div className="gh-login-code-box">
              <span className="gh-login-code-label">One-time code</span>
              <span className="gh-login-code" onClick={handleCopy} title="Click to copy">
                {userCode}
              </span>
            </div>
            <div className="gh-login-code-actions">
              <button type="button" className="gh-login-btn gh-login-btn-secondary" onClick={handleCopy}>
                {copied ? 'Copied ✓' : 'Copy code'}
              </button>
              <button type="button" className="gh-login-btn" onClick={handleOpen}>
                Open GitHub
              </button>
            </div>
            <button type="button" className="gh-login-cancel" onClick={cancel}>
              Cancel
            </button>
          </>
        )}

        {isWaiting && !userCode && (
          <p className="gh-login-sub">Starting…</p>
        )}

        {status === 'error' && error && (
          <p className="gh-login-error">{error}</p>
        )}
      </div>
    </div>
  )
}
