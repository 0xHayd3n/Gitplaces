import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { User } from '../../types/repo'

// Mirror the shape declared in electron/preload.ts → hosts.list.
// Renderer-local copy so we don't have to import from the electron tree at runtime.
interface HostInstance {
  id: string
  type: 'github' | 'gitlab' | 'gitea'
  baseUrl: string
  label: string
  addedAt: string
  webUrl?: string
}

const PAT_DOC_URLS: Record<HostInstance['type'], string> = {
  github: 'https://github.com/settings/tokens',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  gitea:  'https://docs.gitea.com/development/api-usage#authentication',
}

const HOST_ICONS: Record<HostInstance['type'], ReactNode> = {
  github: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  ),
  gitlab: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.49A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92Z"/>
    </svg>
  ),
  gitea: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9z" />
    </svg>
  ),
}

interface HostStatus {
  user: User | null
  loading: boolean
  error: string | null
}

export default function ConnectionsPanel() {
  const [hosts, setHosts] = useState<HostInstance[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [patDraft, setPatDraft] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({})

  const refreshHost = useCallback(async (hostId: string) => {
    setStatuses(prev => ({ ...prev, [hostId]: { ...(prev[hostId] ?? { user: null, error: null }), loading: true } }))
    try {
      const user = await window.api.hosts.getConnectedUser(hostId)
      setStatuses(prev => ({ ...prev, [hostId]: { user, loading: false, error: null } }))
    } catch (e) {
      setStatuses(prev => ({ ...prev, [hostId]: { user: null, loading: false, error: (e as Error).message } }))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await window.api.hosts.list() as HostInstance[]
      if (cancelled) return
      setHosts(list)
      await Promise.all(list.map(h => refreshHost(h.id)))
    }
    load()
    return () => { cancelled = true }
  }, [refreshHost])

  const handleConnect = useCallback(async (host: HostInstance) => {
    const pat = (patDraft[host.id] ?? '').trim()
    if (!pat) return
    setConnecting(prev => ({ ...prev, [host.id]: true }))
    setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: null } }))
    try {
      const result = await window.api.hosts.setToken(host.id, pat)
      setStatuses(prev => ({ ...prev, [host.id]: { user: result.user, loading: false, error: null } }))
      setPatDraft(prev => ({ ...prev, [host.id]: '' }))
    } catch (e) {
      const message = (e as Error).message ?? 'Failed to connect.'
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: message } }))
    } finally {
      setConnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [patDraft])

  const handleDisconnect = useCallback(async (host: HostInstance) => {
    setDisconnecting(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.clearToken(host.id)
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: null } }))
    } finally {
      setDisconnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [])

  const handleOpenPatDocs = useCallback((host: HostInstance) => {
    const url = PAT_DOC_URLS[host.type]
    if (url) void window.api.openExternal(url)
  }, [])

  return (
    <>
      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Repository hosts Git Suite can browse and act on. Use a Personal Access Token for each.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">
          {hosts.length === 0 && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint" style={{ margin: 0 }}>No hosts configured yet.</p>
            </div>
          )}

          {hosts.map(host => {
            const status = statuses[host.id]
            const user = status?.user ?? null
            const isConnecting = connecting[host.id] ?? false
            const isDisconnecting = disconnecting[host.id] ?? false
            const draft = patDraft[host.id] ?? ''
            const error = status?.error ?? null

            return (
              <div key={host.id}>
                <div className="connector-row">
                  <div className={`connector-icon connector-icon--${host.type}`}>
                    {HOST_ICONS[host.type]}
                  </div>
                  <div className="connector-info">
                    <div className="connector-name">{host.label}</div>
                    <div className="connector-desc">
                      {status?.loading
                        ? 'Checking…'
                        : user
                          ? `Connected as @${user.login}`
                          : <>
                              <span>{host.baseUrl}</span>
                              {' — '}
                              <a
                                href="#"
                                onClick={e => { e.preventDefault(); handleOpenPatDocs(host) }}
                              >
                                How do I create a PAT?
                              </a>
                            </>}
                    </div>
                  </div>
                  <div className="connector-actions">
                    {user ? (
                      <>
                        <span className="connector-badge connected">Connected</span>
                        <button
                          className="settings-btn settings-btn--link connector-disconnect-btn"
                          disabled={isDisconnecting}
                          onClick={() => handleDisconnect(host)}
                        >
                          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <form
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                        onSubmit={e => { e.preventDefault(); void handleConnect(host) }}
                      >
                        <input
                          type="password"
                          className="settings-input"
                          placeholder="Personal access token"
                          value={draft}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={e => setPatDraft(prev => ({ ...prev, [host.id]: e.target.value }))}
                          disabled={isConnecting}
                          style={{ minWidth: 220 }}
                        />
                        <button
                          type="submit"
                          className="settings-btn"
                          disabled={isConnecting || draft.trim().length === 0}
                        >
                          {isConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="connector-row connector-row--log">
                    <p className="settings-hint error" style={{ margin: 0 }}>{error}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
