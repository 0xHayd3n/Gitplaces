import { useState, useEffect, useCallback } from 'react'
import { useGitHubAuth } from '../../contexts/GitHubAuth'
import { useGitHubLogin } from '../../hooks/useGitHubLogin'

export default function ConnectorsPanel() {
  const auth = useGitHubAuth()
  const githubLogin = useGitHubLogin()
  const githubUsername = auth.user?.login ?? null
  const githubConnecting = githubLogin.status === 'pending' || githubLogin.status === 'polling'
  const githubUserCode = githubLogin.userCode
  const githubVerificationUri = githubLogin.verificationUri
  const githubVerificationUriComplete = githubLogin.verificationUriComplete
  const githubError = githubLogin.error
  const [githubDisconnecting, setGithubDisconnecting] = useState(false)

  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean
    repoOwner: string | undefined
    failedCount: number
    lastSynced: number | null
  } | null>(null)
  const [syncConnecting, setSyncConnecting] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)

  useEffect(() => {
    window.api.skillSync.getStatus().then(setSyncStatus)
  }, [])

  useEffect(() => {
    const onFailed = () => { window.api.skillSync.getStatus().then(setSyncStatus) }
    window.api.skillSync.onSyncFailed(onFailed)
    return () => window.api.skillSync.offSyncFailed(onFailed)
  }, [])

  const handleSyncConnectClick = useCallback(() => { setSyncConfirmOpen(true) }, [])
  const handleSyncConfirm = useCallback(async () => {
    setSyncConfirmOpen(false)
    setSyncConnecting(true)
    setSyncError(null)
    const result = await window.api.skillSync.setup()
    setSyncConnecting(false)
    if (result.ok) {
      const status = await window.api.skillSync.getStatus()
      setSyncStatus(status)
    } else {
      setSyncError(result.error)
    }
  }, [])
  const handleSyncDisconnect = useCallback(async () => {
    await window.api.skillSync.disconnect()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])
  const handleSyncRetry = useCallback(async () => {
    await window.api.skillSync.retryFailed()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])

  const handleGitHubConnect = () => { githubLogin.start() }
  const handleGitHubDisconnect = async () => {
    githubLogin.reset()
    setGithubDisconnecting(true)
    try {
      await window.api.github.disconnect()
      await auth.refresh()
    } finally {
      setGithubDisconnecting(false)
    }
  }

  return (
    <>
      {syncConfirmOpen && (
        <div className="coll-modal-overlay" onClick={() => setSyncConfirmOpen(false)}>
          <div className="coll-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="coll-modal-title">Connect Skills Backup</div>
            <p className="settings-hint" style={{ marginTop: 8, marginBottom: 16 }}>
              {syncStatus?.repoOwner
                ? <>Connect to your existing <strong>gitsuite-skills</strong> repo.</>
                : <>This will create a private repo <strong>gitsuite-skills</strong> on your GitHub account. Your skills will be pushed there automatically after each generation.</>}
            </p>
            <div className="coll-modal-actions">
              <button className="coll-modal-cancel" onClick={() => setSyncConfirmOpen(false)}>Cancel</button>
              <button className="coll-modal-create" onClick={handleSyncConfirm}>{syncStatus?.repoOwner ? 'Connect' : 'Create & Connect'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Connect external services Git Suite can read from.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">

          {/* GitHub */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--github">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">GitHub</div>
              <div className="connector-desc">
                {githubUsername ? `Connected as @${githubUsername}` : 'Connect your GitHub account'}
              </div>
            </div>
            <div className="connector-actions">
              {githubConnecting ? (
                githubUserCode ? (
                  <div className="connector-device-flow">
                    <span className="connector-code">{githubUserCode}</span>
                    <button className="settings-btn" onClick={() => {
                      const url = githubVerificationUriComplete ?? githubVerificationUri
                      if (url) window.api.github.openLoginPopup(url).catch(() => {})
                    }}>
                      Open login window
                    </button>
                    <button className="settings-btn settings-btn--link" onClick={() => githubLogin.cancel()}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="connector-status-text">Connecting…</span>
                )
              ) : githubUsername ? (
                <>
                  <span className="connector-badge connected">Connected</span>
                  <button
                    className="settings-btn settings-btn--link connector-disconnect-btn"
                    disabled={githubDisconnecting}
                    onClick={handleGitHubDisconnect}
                  >
                    {githubDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button className="settings-btn" onClick={handleGitHubConnect}>Connect</button>
              )}
            </div>
          </div>

          {githubError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{githubError}</p>
            </div>
          )}

          {/* Skills Backup */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--skills-backup">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">Skills Backup</div>
              <div className="connector-desc">
                {syncStatus?.enabled
                  ? syncStatus.failedCount > 0
                    ? 'Last sync failed.'
                    : syncStatus.lastSynced
                      ? <>
                          <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                            {syncStatus.repoOwner}/gitsuite-skills
                          </a>
                          {' — '}Last synced {new Date(syncStatus.lastSynced).toLocaleString()}
                        </>
                      : <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                          {syncStatus.repoOwner}/gitsuite-skills
                        </a>
                  : 'Back up your skills to GitHub'}
              </div>
            </div>
            <div className="connector-actions">
              {syncStatus?.enabled ? (
                syncStatus.failedCount > 0 ? (
                  <>
                    <button className="settings-btn" onClick={handleSyncRetry}>Retry</button>
                    <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                  </>
                ) : (
                  <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                )
              ) : syncConnecting ? (
                <span className="connector-status-text">Connecting…</span>
              ) : (
                <button
                  className="settings-btn"
                  onClick={handleSyncConnectClick}
                  disabled={!githubUsername}
                  title={!githubUsername ? 'Log in to GitHub first' : undefined}
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {syncError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{syncError}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
