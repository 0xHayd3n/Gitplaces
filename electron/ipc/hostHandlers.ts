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

import { ipcMain, type BrowserWindow } from 'electron'
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
import { getProvider } from '../providers/registry'
import { githubUserToUser } from '../providers/github/normalize'
import { HOST_ID_GITHUB, type HostInstance, type HostType } from '../providers/types'
import { openLoginPopup, closeLoginPopup } from '../githubLoginPopup'
import { getDeviceFlowAbort, setDeviceFlowAbort } from '../services/deviceFlowState'

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
    if (input.type === 'github' && input.baseUrl === 'https://api.github.com') {
      return { ok: true }
    }
    // GitLab + Gitea probe paths land with their providers in Phases 4-5.
    return { ok: false, error: `Probe not implemented for host type "${input.type}" yet` }
  })

  ipcMain.handle('hosts:setToken', async (_event, hostId: string, token: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const rawUser = await provider.getUser(token)
    setToken(hostId, token)
    return { user: githubUserToUser(rawUser) }
  })

  ipcMain.handle('hosts:clearToken', (_event, hostId: string) => {
    clearToken(hostId)
  })

  ipcMain.handle('hosts:getConnectedUser', async (_event, hostId: string) => {
    const provider = getProvider(hostId)
    if (!provider) return null
    const token = getToken(hostId)
    if (!token) return null
    try {
      const rawUser = await provider.getUser(token)
      return githubUserToUser(rawUser)
    } catch {
      return null
    }
  })

  // ── Device flow ─────────────────────────────────────────────────
  ipcMain.handle('hosts:startDeviceFlow', async (_event, hostId: string) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    getDeviceFlowAbort()?.abort()
    setDeviceFlowAbort(new AbortController())
    const start = await provider.startDeviceFlow()
    // Mirror github:startDeviceFlow — auto-open the verification page.
    openLoginPopup(start.verificationUriComplete, getMainWindow())
    return start
  })

  ipcMain.handle('hosts:pollDeviceToken', async (_event, hostId: string, deviceCode: string, interval: number) => {
    const provider = getProvider(hostId)
    if (!provider) throw new Error(`Unknown host: ${hostId}`)
    const controller = getDeviceFlowAbort() ?? new AbortController()
    try {
      const token = await provider.pollDeviceToken(deviceCode, interval, controller.signal)
      setToken(hostId, token)
      const rawUser = await provider.getUser(token)
      return { user: githubUserToUser(rawUser) }
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
