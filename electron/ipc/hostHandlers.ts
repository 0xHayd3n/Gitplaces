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
  })

  ipcMain.handle('hosts:probe', async (_event, input: ProbeInput): Promise<ProbeResult> => {
    if (input.type === 'github') {
      if (input.baseUrl === 'https://api.github.com') return { ok: true }
      return { ok: false, error: 'GitHub Enterprise probes are not supported yet' }
    }

    if (input.type === 'gitlab') {
      const v = await getGitLabServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a GitLab instance (no /api/v4/version)` }
    }

    if (input.type === 'gitea') {
      const v = await getGiteaServerVersion(input.baseUrl)
      if (v && typeof v.version === 'string' && v.version.length > 0) {
        return { ok: true }
      }
      return { ok: false, error: `${input.baseUrl} did not respond as a Gitea instance (no /api/v1/version)` }
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
    return { user }
  })

  ipcMain.handle('hosts:clearToken', (_event, hostId: string) => {
    clearToken(hostId)
    if (hostId === HOST_ID_GITHUB) {
      clearGitHubUser()
      const db = getDb(app.getPath('userData'))
      db.prepare('DELETE FROM settings WHERE key = ?').run('github_username')
    }
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
