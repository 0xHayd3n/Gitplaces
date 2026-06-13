import { ipcMain, app, shell } from 'electron'
import { getDb } from '../db'
import { getToken, getGitHubUser } from '../store'
import { TEMPLATES } from '../templates/index'
import {
  startSession, getSessions, getSession, appendMessage,
  updateRepoIds, updateName, markPublished, setDirty, clearDirty,
  getFileList, deleteSession, dirtyMap, pendingChangesMap
} from '../services/createSessionService'
import { buildSystemPrompt, extractFiles, truncateHistory } from '../services/createAiService'
import { buildPushUrl, cleanRepoUrl, gitInit, gitCommitAll, gitPush } from '../services/createGitService'
import {
  startHttpServer, stopHttpServer,
  spawnMcpProcess, killMcpProcess, getMcpProcess,
  launchWidgetWindow, closeWidgetWindow, detachWidgetWindow,
  closeAllForSession, closeAllOnQuit
} from '../services/createPreviewService'
import { sendMessageStream } from '../services/aiChatService'
import { githubHeaders } from '../providers/github'
import type { CreateMessage, ToolType } from '../../src/types/create'

export function registerCreateHandlers(): void {
  ipcMain.handle('create:getTemplates', () => TEMPLATES)

  ipcMain.handle('create:startSession', async (_event, payload: { templateId: string; toolType: ToolType; name: string }) => {
    const db = getDb(app.getPath('userData'))
    return startSession(db, payload.templateId, payload.toolType, payload.name)
  })

  ipcMain.handle('create:getSessions', () => {
    const db = getDb(app.getPath('userData'))
    return getSessions(db)
  })

  ipcMain.handle('create:getSession', async (_event, id: string) => {
    const db = getDb(app.getPath('userData'))
    const session = await getSession(db, id)
    if (!session || !session.localPath) return session
    const files = await getFileList(session.localPath)
    return { ...session, files, dirty: dirtyMap.get(id) ?? false, pendingChanges: pendingChangesMap.get(id) ?? [] }
  })

  ipcMain.handle('create:updateName', (_event, id: string, name: string) => {
    const db = getDb(app.getPath('userData'))
    updateName(db, id, name)
  })

  ipcMain.handle('create:updateRepos', (_event, id: string, repoIds: string[]) => {
    const db = getDb(app.getPath('userData'))
    updateRepoIds(db, id, repoIds)
  })

  ipcMain.handle('create:deleteSession', async (_event, id: string) => {
    const db = getDb(app.getPath('userData'))
    closeAllForSession(id)
    await deleteSession(db, id)
  })

  ipcMain.handle('create:sendMessage', async (event, payload: {
    sessionId: string
    userMessage: string
    templateName: string
    toolType: ToolType
    repos: { name: string; description: string; readmeExcerpt: string }[]
    history: CreateMessage[]
  }) => {
    const db = getDb(app.getPath('userData'))
    const session = await getSession(db, payload.sessionId)
    if (!session) throw new Error('Session not found')

    const systemPrompt = buildSystemPrompt(payload.templateName, payload.toolType, payload.repos)
    const userMsg: CreateMessage = { role: 'user', content: payload.userMessage, timestamp: Date.now() }
    appendMessage(db, payload.sessionId, userMsg)

    const truncated = truncateHistory([...payload.history, userMsg])
    const aiMessages = truncated.map(m => ({ role: m.role, content: m.content }))

    return new Promise<{ reply: string; changedFiles: string[] }>((resolve, reject) => {
      sendMessageStream(
        aiMessages as Parameters<typeof sendMessageStream>[0],
        [],
        [],
        systemPrompt,
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        {
          onToken: (token) => {
            const { BrowserWindow } = require('electron') as typeof import('electron')
            const win = BrowserWindow.fromWebContents(event.sender)
            if (win && !win.isDestroyed()) win.webContents.send('create:stream-token', { sessionId: payload.sessionId, token })
          },
          onDone: async (text) => {
            const { files, reply } = extractFiles(text)
            const changedFiles: string[] = []
            if (files.length > 0 && session.localPath) {
              const { mkdir, writeFile } = await import('fs/promises')
              const pathMod = await import('path')
              for (const f of files) {
                const dest = pathMod.join(session.localPath, f.path)
                await mkdir(pathMod.dirname(dest), { recursive: true })
                await writeFile(dest, f.content, 'utf-8')
                changedFiles.push(f.path)
              }
              const fresh = await getSession(db, payload.sessionId)
              if (fresh?.publishStatus === 'published') {
                setDirty(payload.sessionId, changedFiles)
              }
            }
            const assistantMsg: CreateMessage = { role: 'assistant', content: reply, changedFiles, timestamp: Date.now() }
            appendMessage(db, payload.sessionId, assistantMsg)
            resolve({ reply, changedFiles })
          },
          onError: reject,
        }
      ).catch(reject)
    })
  })

  ipcMain.handle('create:startWebPreview', async (_event, sessionId: string, localPath: string) => {
    const port = await startHttpServer(sessionId, localPath)
    return { port, url: `http://localhost:${port}` }
  })

  ipcMain.handle('create:stopPreview', async (_event, sessionId: string) => {
    closeAllForSession(sessionId)
  })

  ipcMain.handle('create:spawnMcp', (_event, sessionId: string, entryPoint: string, cwd: string) => {
    const proc = spawnMcpProcess(sessionId, entryPoint, cwd)
    return new Promise<{ ok: boolean }>((resolve) => {
      setTimeout(() => resolve({ ok: !proc.killed }), 800)
    })
  })

  ipcMain.handle('create:getMcpTools', (_event, sessionId: string) => {
    const proc = getMcpProcess(sessionId)
    if (!proc) return []
    return new Promise<unknown[]>((resolve) => {
      const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      let response = ''
      const handler = (data: Buffer) => {
        response += data.toString()
        try {
          const parsed = JSON.parse(response)
          proc.stdout?.off('data', handler)
          resolve((parsed as { result?: { tools?: unknown[] } }).result?.tools ?? [])
        } catch { /* incomplete */ }
      }
      proc.stdout?.on('data', handler)
      proc.stdin?.write(request + '\n')
      setTimeout(() => { proc.stdout?.off('data', handler); resolve([]) }, 3000)
    })
  })

  ipcMain.handle('create:callMcpTool', () => {
    // v1 stub — real tool invocation is a v2 task
    return null
  })

  ipcMain.handle('create:generateReadme', () => {
    // v1 stub — README generation is deferred
    return null
  })

  ipcMain.handle('create:launchWidget', (_event, sessionId: string, localPath: string) => {
    launchWidgetWindow(sessionId, localPath)
  })

  ipcMain.handle('create:detachWidget', (_event, sessionId: string) => {
    detachWidgetWindow(sessionId)
  })

  ipcMain.handle('create:relaunchWidget', (_event, sessionId: string, localPath: string) => {
    closeWidgetWindow(sessionId)
    setTimeout(() => launchWidgetWindow(sessionId, localPath), 500)
  })

  ipcMain.handle('create:getSuggestions', async () => {
    // v1: deferred
    return []
  })

  ipcMain.handle('create:openFolder', (_event, localPath: string) => {
    shell.openPath(localPath)
  })

  ipcMain.handle('create:getFileContent', async (_event, localPath: string, filePath: string) => {
    const { readFile } = await import('fs/promises')
    const pathMod = await import('path')
    return readFile(pathMod.join(localPath, filePath), 'utf-8')
  })

  ipcMain.handle('create:publishToGitHub', async (_event, payload: {
    sessionId: string
    repoName: string
    description: string
    isPrivate: boolean
    localPath: string
  }) => {
    const token = getToken()
    const user = getGitHubUser()
    if (!token || !user) throw new Error('Not authenticated')

    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: payload.repoName, description: payload.description, private: payload.isPrivate, auto_init: false }),
    })
    if (res.status === 403) throw new Error('SCOPE_MISSING')
    if (!res.ok) throw new Error(`GitHub error: ${res.status}`)
    const repoData = await res.json() as { html_url: string; name: string }

    await gitInit(payload.localPath)
    await gitCommitAll(payload.localPath, 'Initial commit via Git Suite Create')
    const pushUrl = buildPushUrl(token, user.username, repoData.name)
    await gitPush(payload.localPath, pushUrl)

    const cleanUrl = cleanRepoUrl(user.username, repoData.name)
    const db = getDb(app.getPath('userData'))
    markPublished(db, payload.sessionId, cleanUrl)
    return { githubRepoUrl: cleanUrl }
  })

  ipcMain.handle('create:pushUpdate', async (_event, payload: {
    sessionId: string
    localPath: string
    githubRepoUrl: string
  }) => {
    const token = getToken()
    const user = getGitHubUser()
    if (!token || !user) throw new Error('Not authenticated')
    const repoName = payload.githubRepoUrl.split('/').pop()!
    await gitCommitAll(payload.localPath, 'Update via Git Suite Create')
    const pushUrl = buildPushUrl(token, user.username, repoName)
    await gitPush(payload.localPath, pushUrl)
    clearDirty(payload.sessionId)
  })
}

export { closeAllOnQuit }
