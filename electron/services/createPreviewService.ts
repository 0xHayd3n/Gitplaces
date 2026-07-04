import { BrowserWindow } from 'electron'
import { createServer, type Server } from 'http'
import { readFile } from 'fs/promises'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'

const httpServers = new Map<string, { server: Server; port: number }>()
const mcpProcesses = new Map<string, ChildProcess>()
const widgetWindows = new Map<string, BrowserWindow>()

export async function startHttpServer(sessionId: string, localPath: string): Promise<number> {
  await stopHttpServer(sessionId)
  const server = createServer(async (req, res) => {
    const filePath = path.join(localPath, req.url === '/' ? 'index.html' : req.url!)
    try {
      const data = await readFile(filePath)
      const ext = path.extname(filePath).slice(1)
      const mime: Record<string, string> = { html: 'text/html', js: 'application/javascript', ts: 'application/javascript', css: 'text/css', json: 'application/json' }
      res.writeHead(200, { 'Content-Type': mime[ext] ?? 'text/plain' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve(addr.port)
    })
    server.on('error', reject)
  })
  httpServers.set(sessionId, { server, port })
  return port
}

export async function stopHttpServer(sessionId: string): Promise<void> {
  const entry = httpServers.get(sessionId)
  if (entry) {
    await new Promise<void>(resolve => entry.server.close(() => resolve()))
    httpServers.delete(sessionId)
  }
}

export function getHttpPort(sessionId: string): number | null {
  return httpServers.get(sessionId)?.port ?? null
}

export function spawnMcpProcess(sessionId: string, entryPoint: string, cwd: string): ChildProcess {
  killMcpProcess(sessionId)
  const proc = spawn('node', [entryPoint], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  mcpProcesses.set(sessionId, proc)
  return proc
}

export function killMcpProcess(sessionId: string): void {
  const proc = mcpProcesses.get(sessionId)
  if (proc && !proc.killed) proc.kill()
  mcpProcesses.delete(sessionId)
}

export function getMcpProcess(sessionId: string): ChildProcess | undefined {
  return mcpProcesses.get(sessionId)
}

export function launchWidgetWindow(sessionId: string, localPath: string): BrowserWindow {
  closeWidgetWindow(sessionId)
  const win = new BrowserWindow({
    width: 300,
    height: 200,
    alwaysOnTop: true,
    frame: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: 'Gitplaces Widget',
  })
  win.loadFile(path.join(localPath, 'index.html'))
  widgetWindows.set(sessionId, win)
  win.on('closed', () => widgetWindows.delete(sessionId))
  return win
}

export function closeWidgetWindow(sessionId: string): void {
  const win = widgetWindows.get(sessionId)
  if (win && !win.isDestroyed()) win.close()
  widgetWindows.delete(sessionId)
}

export function detachWidgetWindow(sessionId: string): void {
  widgetWindows.delete(sessionId)
}

export function closeAllForSession(sessionId: string): void {
  stopHttpServer(sessionId)
  killMcpProcess(sessionId)
  closeWidgetWindow(sessionId)
}

export function closeAllOnQuit(): void {
  for (const [id] of widgetWindows) closeWidgetWindow(id)
  for (const [id] of mcpProcesses) killMcpProcess(id)
  for (const [id] of httpServers) stopHttpServer(id)
}
