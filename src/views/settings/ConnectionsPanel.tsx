import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react'
import type { User } from '../../types/repo'
import { clearCachedCapabilities } from '../../hooks/useHostCapabilities'

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

const HOST_ID_GITHUB = 'gh:api.github.com'

function patDocsUrl(host: HostInstance): string {
  // For gitlab + gitea, deep-link to the matching path on the host's own
  // webUrl (or API baseUrl when there's no explicit webUrl).
  const base = (host.webUrl ?? host.baseUrl).replace(/\/+$/, '')
  switch (host.type) {
    case 'github': return 'https://github.com/settings/tokens'
    case 'gitlab': return `${base}/-/user_settings/personal_access_tokens`
    case 'gitea':  return `${base}/user/settings/applications`
  }
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

type HealthStatus = { ok: true } | { ok: false; error: string }

export default function ConnectionsPanel() {
  const [hosts, setHosts] = useState<HostInstance[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [health, setHealth] = useState<Record<string, HealthStatus>>({})
  const [patDraft, setPatDraft] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({})
  const [removing, setRemoving] = useState<Record<string, boolean>>({})

  // Per-host label-edit state. When `editingLabel[hostId]` is a string, the
  // label cell renders as an input; null means the label is in display mode.
  const [editingLabel, setEditingLabel] = useState<Record<string, string | null>>({})
  const [labelBusy, setLabelBusy] = useState<Record<string, boolean>>({})

  // Add-a-host form state.
  const [showAddForm, setShowAddForm] = useState(false)
  const [addType, setAddType] = useState<'github' | 'gitlab' | 'gitea'>('gitlab')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const refreshHost = useCallback(async (hostId: string) => {
    setStatuses(prev => ({ ...prev, [hostId]: { ...(prev[hostId] ?? { user: null, error: null }), loading: true } }))
    try {
      const user = await window.api.hosts.getConnectedUser(hostId)
      setStatuses(prev => ({ ...prev, [hostId]: { user, loading: false, error: null } }))
    } catch (e) {
      setStatuses(prev => ({ ...prev, [hostId]: { user: null, loading: false, error: (e as Error).message } }))
    }
  }, [])

  const loadHosts = useCallback(async (): Promise<HostInstance[]> => {
    const list = await window.api.hosts.list() as HostInstance[]
    setHosts(list)
    return list
  }, [])

  const runHealthCheck = useCallback(async () => {
    try {
      const result = await window.api.hosts.healthCheck()
      setHealth(result)
    } catch {
      // non-critical — leave previous health state in place
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const list = await loadHosts()
      if (cancelled) return
      await Promise.all(list.map(h => refreshHost(h.id)))
      if (cancelled) return
      void runHealthCheck()
    }
    load()
    return () => { cancelled = true }
  }, [loadHosts, refreshHost, runHealthCheck])

  const handleConnect = useCallback(async (host: HostInstance) => {
    const pat = (patDraft[host.id] ?? '').trim()
    if (!pat) return
    setConnecting(prev => ({ ...prev, [host.id]: true }))
    setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: null } }))
    try {
      const result = await window.api.hosts.setToken(host.id, pat)
      // Drop the capability cache locally before the broadcast round-trip
      // arrives — keeps any mounted hook from briefly showing pre-auth caps.
      clearCachedCapabilities(host.id)
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
      clearCachedCapabilities(host.id)
      setStatuses(prev => ({ ...prev, [host.id]: { user: null, loading: false, error: null } }))
    } catch (e) {
      const message = (e as Error).message ?? 'Failed to disconnect.'
      setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: message } }))
    } finally {
      setDisconnecting(prev => ({ ...prev, [host.id]: false }))
    }
  }, [])

  const handleRemove = useCallback(async (host: HostInstance) => {
    if (host.id === HOST_ID_GITHUB) return
    setRemoving(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.remove(host.id)
      await loadHosts()
      setHealth(prev => {
        const next = { ...prev }
        delete next[host.id]
        return next
      })
    } catch (e) {
      setStatuses(prev => ({ ...prev, [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: (e as Error).message } }))
    } finally {
      setRemoving(prev => ({ ...prev, [host.id]: false }))
    }
  }, [loadHosts])

  const handleOpenPatDocs = useCallback((host: HostInstance) => {
    void window.api.openExternal(patDocsUrl(host))
  }, [])

  const handleStartEditLabel = useCallback((host: HostInstance) => {
    setEditingLabel(prev => ({ ...prev, [host.id]: host.label }))
  }, [])

  const handleCancelEditLabel = useCallback((hostId: string) => {
    setEditingLabel(prev => ({ ...prev, [hostId]: null }))
  }, [])

  const handleSaveLabel = useCallback(async (host: HostInstance) => {
    const draft = (editingLabel[host.id] ?? '').trim()
    if (draft.length === 0 || draft === host.label) {
      setEditingLabel(prev => ({ ...prev, [host.id]: null }))
      return
    }
    setLabelBusy(prev => ({ ...prev, [host.id]: true }))
    try {
      await window.api.hosts.setLabel(host.id, draft)
      await loadHosts()
      setEditingLabel(prev => ({ ...prev, [host.id]: null }))
    } catch (e) {
      setStatuses(prev => ({
        ...prev,
        [host.id]: { ...(prev[host.id] ?? { user: null, loading: false }), error: (e as Error).message },
      }))
    } finally {
      setLabelBusy(prev => ({ ...prev, [host.id]: false }))
    }
  }, [editingLabel, loadHosts])

  const handleAddSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    const baseUrl = addBaseUrl.trim().replace(/\/+$/, '')
    const label = addLabel.trim() || baseUrl
    if (!baseUrl) { setAddError('Enter a base URL.'); return }
    if (!/^https?:\/\//i.test(baseUrl)) { setAddError('Base URL must start with https:// or http://.'); return }

    setAddBusy(true)
    setAddError(null)
    try {
      const probe = await window.api.hosts.probe({ type: addType, baseUrl })
      if (!probe.ok) {
        setAddError(probe.error ?? 'Probe failed.')
        return
      }
      // `hosts:add` returns the canonical HostInstance with its deterministic
      // id — use that rather than scanning the refreshed list by baseUrl
      // (mixed-case input would silently skip refreshHost since the stored
      // baseUrl preserves the user's original casing while computeHostId
      // lowercases for the id).
      const added = await window.api.hosts.add({ type: addType, baseUrl, label, webUrl: baseUrl })
      await loadHosts()
      await refreshHost(added.id)
      void runHealthCheck()
      // Reset form
      setAddBaseUrl('')
      setAddLabel('')
      setShowAddForm(false)
    } catch (err) {
      setAddError((err as Error).message ?? 'Failed to add host.')
    } finally {
      setAddBusy(false)
    }
  }, [addType, addBaseUrl, addLabel, loadHosts, refreshHost, runHealthCheck])

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
            const isRemoving = removing[host.id] ?? false
            const draft = patDraft[host.id] ?? ''
            const error = status?.error ?? null
            const hostHealth = health[host.id]
            const isUnreachable = hostHealth && hostHealth.ok === false
            const canRemove = host.id !== HOST_ID_GITHUB

            return (
              <div key={host.id}>
                <div className="connector-row">
                  <div className={`connector-icon connector-icon--${host.type}`}>
                    {HOST_ICONS[host.type]}
                  </div>
                  <div className="connector-info">
                    <div className="connector-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isUnreachable && (
                        <span
                          aria-label="Unreachable"
                          title="Unreachable"
                          style={{
                            width: 8, height: 8, borderRadius: 4,
                            background: 'var(--danger, #d33)',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      {editingLabel[host.id] != null ? (
                        <form
                          style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                          onSubmit={e => { e.preventDefault(); void handleSaveLabel(host) }}
                        >
                          <input
                            className="settings-input"
                            type="text"
                            value={editingLabel[host.id] ?? ''}
                            onChange={e => setEditingLabel(prev => ({ ...prev, [host.id]: e.target.value }))}
                            disabled={labelBusy[host.id] ?? false}
                            autoFocus
                            style={{ minWidth: 160 }}
                          />
                          <button
                            type="submit"
                            className="settings-btn settings-btn--link"
                            disabled={labelBusy[host.id] ?? false}
                          >
                            {labelBusy[host.id] ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="settings-btn settings-btn--link"
                            onClick={() => handleCancelEditLabel(host.id)}
                            disabled={labelBusy[host.id] ?? false}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <span>{host.label}</span>
                          <button
                            type="button"
                            aria-label={`Edit label for ${host.label}`}
                            title="Edit label"
                            className="settings-btn settings-btn--link"
                            onClick={() => handleStartEditLabel(host)}
                            style={{ padding: '0 4px', fontSize: 11 }}
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </div>
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
                    {canRemove && (
                      <button
                        aria-label={`Remove ${host.label}`}
                        title={`Remove ${host.label}`}
                        className="settings-btn settings-btn--link connector-remove-btn"
                        disabled={isRemoving}
                        onClick={() => handleRemove(host)}
                        style={{ marginLeft: 8 }}
                      >
                        {isRemoving ? '…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>

                {isUnreachable && (
                  <div className="connector-row connector-row--log">
                    <p className="settings-hint error" style={{ margin: 0 }}>
                      Unreachable: {hostHealth.error}
                    </p>
                  </div>
                )}

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

      <div className="settings-group" style={{ marginTop: 16 }}>
        <div className="settings-group-body">
          {!showAddForm ? (
            <button
              type="button"
              className="settings-btn"
              onClick={() => setShowAddForm(true)}
            >
              Add a host…
            </button>
          ) : (
            <form
              onSubmit={handleAddSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Type</span>
                  <select
                    className="settings-input"
                    value={addType}
                    onChange={e => setAddType(e.target.value as 'github' | 'gitlab' | 'gitea')}
                    disabled={addBusy}
                  >
                    <option value="gitlab">GitLab</option>
                    <option value="gitea">Gitea</option>
                    <option value="github">GitHub Enterprise</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Base URL</span>
                  <input
                    className="settings-input"
                    type="url"
                    placeholder="https://gitlab.acme.com"
                    value={addBaseUrl}
                    onChange={e => setAddBaseUrl(e.target.value)}
                    disabled={addBusy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                  <span className="settings-hint" style={{ fontSize: 12 }}>Label</span>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="Acme GitLab"
                    value={addLabel}
                    onChange={e => setAddLabel(e.target.value)}
                    disabled={addBusy}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="settings-btn" disabled={addBusy}>
                  {addBusy ? 'Probing…' : 'Add host'}
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn--link"
                  onClick={() => {
                    setShowAddForm(false)
                    setAddError(null)
                    setAddBaseUrl('')
                    setAddLabel('')
                  }}
                  disabled={addBusy}
                >
                  Cancel
                </button>
              </div>
              {addError && (
                <p className="settings-hint error" style={{ margin: 0 }}>{addError}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </>
  )
}
