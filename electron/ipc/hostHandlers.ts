// electron/ipc/hostHandlers.ts
//
// Manages host instances (the list of GitHub/GitLab/Gitea servers the user
// has connected) and the per-host PATs/OAuth tokens. Phase 3 surfaces the
// IPC; Phase 7 builds the Connections-pane UI that exercises it.
//
// The device-flow and login-popup channels share state with the legacy
// `github:*` handlers in electron/main.ts during Phase 3 — the abort
// controller lives in electron/services/deviceFlowState.ts and the popup
// singleton lives in electron/githubLoginPopup.ts. After Task 13 deletes the
// legacy handlers, only this file owns those interactions.

import { ipcMain, app, type BrowserWindow } from 'electron'
import {
  listHosts,
  getHost,
  addHost,
  removeHost,
} from '../providers/hostConfig'
import {
  getToken,
  setToken,
  clearToken,
} from '../providers/tokenStore'
import { getAnyProvider } from '../providers/registry'
import { HOST_ID_GITHUB, type HostInstance, type HostType } from '../providers/types'
import { openLoginPopup, closeLoginPopup } from '../githubLoginPopup'
import { getDeviceFlowAbort, setDeviceFlowAbort } from '../services/deviceFlowState'
import { setGitHubUser, clearGitHubUser } from '../store'
import { getDb } from '../db'
import { initTopicCache } from '../services/topicCacheService'
import { getServerVersion as getGitLabServerVersion } from '../providers/gitlab/rest'
import { getServerVersion as getGiteaServerVersion } from '../providers/gitea/rest'

interface AddHostInput {
  type: HostType
  baseUrl: string
  label: string
  webUrl?: string
}

interface ProbeInput {
  type: HostType
  baseUrl: string
}

interface ProbeResult {
  ok: boolean
  error?: string
}

type ServerVersionFailure = { ok: false; errorKind: 'tls' | 'network' | 'http' | 'json'; error: string }

function formatProbeError(v: ServerVersionFailure): string {
  // Each errorKind's `error` string is already a complete user-facing message
  // ("TLS handshake failed (CERT_HAS_EXPIRED)", "Could not reach https://… (ENOTFOUND)",
  // "HTTP 404 — Not Found", "https://… did not respond as a GitLab instance (…)").
  // Pass through unchanged — the kind tag itself is the discriminant for any
  // future per-kind UI treatment in the renderer.
  return v.error
}

function broadcastCapabilitiesChanged(
  getMainWindow: () => BrowserWindow | null,
  hostId: string,
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('hosts:capabilities-changed', { hostId })
  }
}

/**
 * Registers every `hosts:*` IPC handler. The `getMainWindow` callback gives
 * the login-popup a parent BrowserWindow — main.ts owns the singleton
 * mainWindow reference, so it passes a getter rather than a snapshot to
 * survive window recreation.
 */
export function registerHostHandlers(getMainWindow: () => BrowserWindow | null = () => null): void {
  ipcMain.handle('hosts:list', () => listHosts())

  ipcMain.handle('hosts:get', (_event, hostId: string) => getHost(hostId))

  ipcMain.handle('hosts:add', (_event, input: AddHostInput): HostInstance => {
    return addHost(input)
  })

  ipcMain.handle('hosts:remove', (_event, hostId: string) => {
    if (hostId === HOST_ID_GITHUB) {
      throw new Error('Cannot remove the GitHub host')
    }
    clearToken(hostId)
    removeHost(hostId)
    broadcastCapabilitiesChanged(getMainWindow, hostId)
  })

  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v.ok) return { ok: true }
      return { ok: false, error: formatProbeError(v) }
    }

    if (input.type === 'gitea') {
      const v = await getGiteaServerVersion(input.baseUrl)
      if (v.ok) return { ok: true }
      return { ok: false, error: formatProbeError(v) }
    }

    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })

  ipcMain.handle('hosts:setToken', async (_event, hostId: string, token: string) => {
    const provider = getAnyProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const user = await provider.getCurrentUser(token)
    setToken(hostId, token)
    // GitHub remains the canonical identity for legacy consumers (createHandlers,
    // updateService user-filter, skillSync:setup, recommendation owner-filter).
    // Other hosts skip this mirroring until their consumers learn multi-host.
    if (hostId === HOST_ID_GITHUB) {
      setGitHubUser(user.login, user.avatarUrl)
      const db = getDb(app.getPath('userData'))
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
    }
    broadcastCapabilitiesChanged(getMainWindow, hostId)
    return { user }
  })

  ipcMain.handle('hosts:clearToken', (_event, hostId: string) => {
    clearToken(hostId)
    if (hostId === HOST_ID_GITHUB) {
      clearGitHubUser()
      const db = getDb(app.getPath('userData'))
      db.prepare('DELETE FROM settings WHERE key = ?').run('github_username')
    }
    broadcastCapabilitiesChanged(getMainWindow, hostId)
  })

  ipcMain.handle('hosts:getConnectedUser', async (_event, hostId: string) => {
    const provider = getAnyProvider(hostId)
    if (!provider) return null
    const token = getToken(hostId)
    if (!token) return null
    try {
      return await provider.getCurrentUser(token)
    } catch {
      return null
    }
  })

  ipcMain.handle('hosts:getCapabilities', (_event, hostId: string) => {
    const provider = getAnyProvider(hostId)
    if (!provider) return null
    return provider.capabilities()
  })

  ipcMain.handle('hosts:healthCheck', async (): Promise<Record<string, { ok: true } | { ok: false; error: string }>> => {
    const out: Record<string, { ok: true } | { ok: false; error: string }> = {}
    await Promise.all(listHosts().map(async (host) => {
      // GitHub doesn't expose /version the same way; assume reachable.
      if (host.type === 'github') { out[host.id] = { ok: true }; return }

      const v = host.type === 'gitlab'
        ? await getGitLabServerVersion(host.baseUrl)
        : await getGiteaServerVersion(host.baseUrl)
      out[host.id] = v.ok ? { ok: true } : { ok: false, error: v.error }
    }))
    return out
  })

  // ── Device flow ─────────────────────────────────────────────────
  ipcMain.handle('hosts:startDeviceFlow', async (_event, hostId: string) => {
    const provider = getAnyProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    getDeviceFlowAbort()?.abort()
    setDeviceFlowAbort(new AbortController())
    const start = await provider.startDeviceFlow()
    // Mirror github:startDeviceFlow — auto-open the verification page.
    openLoginPopup(start.verificationUriComplete, getMainWindow())
    return start
  })

  ipcMain.handle('hosts:pollDeviceToken', async (_event, hostId: string, deviceCode: string, interval: number) => {
    const provider = getAnyProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const controller = getDeviceFlowAbort() ?? new AbortController()
    try {
      const token = await provider.pollDeviceToken(deviceCode, interval, controller.signal)
      setToken(hostId, token)
      const user = await provider.getCurrentUser(token)
      // GitHub-specific: mirror identity into legacy slots (see hosts:setToken
      // for the full rationale) and warm the topic cache for Discover.
      if (hostId === HOST_ID_GITHUB) {
        setGitHubUser(user.login, user.avatarUrl)
        const db = getDb(app.getPath('userData'))
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('github_username', user.login)
        initTopicCache(token).catch(() => {}) // Non-blocking
      }
      broadcastCapabilitiesChanged(getMainWindow, hostId)
      return { user }
    } finally {
      closeLoginPopup()
    }
  })

  ipcMain.handle('hosts:cancelDeviceFlow', (_event, _hostId: string) => {
    getDeviceFlowAbort()?.abort()
    setDeviceFlowAbort(null)
    closeLoginPopup()
  })

  ipcMain.handle('hosts:openLoginPopup', (_event, _hostId: string, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return
    openLoginPopup(url, getMainWindow())
  })
}
