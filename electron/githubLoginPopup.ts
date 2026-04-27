import { BrowserWindow, shell } from 'electron'

let popup: BrowserWindow | null = null

export function openLoginPopup(url: string, parent: BrowserWindow | null = null): BrowserWindow {
  if (popup && !popup.isDestroyed()) {
    popup.loadURL(url).catch(() => {})
    popup.focus()
    return popup
  }

  popup = new BrowserWindow({
    width: 540,
    height: 760,
    parent: parent ?? undefined,
    modal: false,
    backgroundColor: '#0d1117',
    title: 'Sign in to GitHub',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  popup.loadURL(url).catch(() => {})

  popup.on('closed', () => { popup = null })

  // External links from inside the popup → system browser, never embed
  popup.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://') || target.startsWith('http://')) {
      shell.openExternal(target).catch(() => {})
    }
    return { action: 'deny' }
  })

  popup.webContents.on('will-navigate', (e, target) => {
    // Lock to https-only navigation; blocks file://, javascript:, etc.
    if (!target.startsWith('https://')) e.preventDefault()
  })

  return popup
}

export function closeLoginPopup(): void {
  if (popup && !popup.isDestroyed()) popup.close()
  popup = null
}
