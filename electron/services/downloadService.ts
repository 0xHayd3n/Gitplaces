import { BrowserWindow, dialog } from 'electron'

function getParentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
}
import JSZip from 'jszip'
import { getToken } from '../store'
import { getTreeBySha, getBlobBySha, getBranch, githubHeaders } from '../github'

const MD_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

function isMarkdown(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MD_EXTENSIONS.has(ext)
}

interface DownloadParams {
  owner: string
  name: string
  branch: string
  path: string
}

interface ConvertParams extends DownloadParams {
  format: 'docx' | 'pdf' | 'epub'
  isFolder: boolean
}

// ── Raw File Download ──

export async function downloadRawFile(params: DownloadParams): Promise<void> {
  const { owner, name, path } = params
  const filename = path.split('/').pop() ?? 'file'
  const token = getToken() ?? null

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${params.branch}`,
    { headers: githubHeaders(token) }
  )
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`)
  const json = await res.json()
  const buffer = Buffer.from(json.content, 'base64')

  const result = await dialog.showSaveDialog(getParentWindow()!, {
    defaultPath: filename,
    filters: [{ name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return

  const fs = await import('fs/promises')
  await fs.writeFile(result.filePath, buffer)
}

// ── Raw Folder Download (as .zip) ──

export async function downloadRawFolder(params: DownloadParams): Promise<void> {
  const { owner, name, branch, path } = params
  const token = getToken() ?? null
  const folderName = path.split('/').pop() ?? 'folder'

  const branchInfo = await getBranch(token, owner, name, branch)
  const treeSha = await resolveTreeSha(token, owner, name, branchInfo.rootTreeSha, path)
  if (!treeSha) throw new Error('Folder not found')

  // Use recursive tree fetch to include all nested files
  const entries = await getRecursiveTree(token, owner, name, treeSha)
  const zip = new JSZip()

  for (const entry of entries) {
    if (entry.type === 'blob') {
      const blob = await getBlobBySha(token, owner, name, entry.sha)
      zip.file(entry.path, Buffer.from(blob.rawBase64, 'base64'))
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  const result = await dialog.showSaveDialog(getParentWindow()!, {
    defaultPath: `${folderName}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  })
  if (result.canceled || !result.filePath) return

  const fs = await import('fs/promises')
  await fs.writeFile(result.filePath, zipBuffer)
}

// ── Convert Markdown → Format ──

export async function downloadConverted(params: ConvertParams): Promise<void> {
  const { owner, name, branch, path, format, isFolder } = params
  const token = getToken() ?? null

  let markdownContent: string
  let defaultName: string

  if (isFolder) {
    const folderName = path.split('/').pop() ?? 'document'
    defaultName = folderName

    const branchInfo = await getBranch(token, owner, name, branch)
    const treeSha = await resolveTreeSha(token, owner, name, branchInfo.rootTreeSha, path)
    if (!treeSha) throw new Error('Folder not found')

    const entries = await getRecursiveTree(token, owner, name, treeSha)
    const mdEntries = entries
      .filter(e => e.type === 'blob' && isMarkdown(e.path))
      .sort((a, b) => a.path.localeCompare(b.path))

    if (mdEntries.length === 0) {
      throw new Error('No markdown files found in this folder')
    }

    const parts: string[] = []
    for (const entry of mdEntries) {
      const blob = await getBlobBySha(token, owner, name, entry.sha)
      parts.push(blob.content)
    }
    markdownContent = parts.join('\n\n---\n\n')
  } else {
    defaultName = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'document'

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${branch}`,
      { headers: githubHeaders(token) }
    )
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`)
    const json = await res.json()
    markdownContent = Buffer.from(json.content, 'base64').toString('utf-8')
  }

  const { marked } = await import('marked')
  const html = await marked.parse(markdownContent)
  const styledHtml = wrapHtml(html, defaultName)

  switch (format) {
    case 'pdf':
      await convertToPdf(styledHtml, defaultName)
      break
    case 'docx':
      await convertToDocx(styledHtml, defaultName)
      break
    case 'epub':
      await convertToEpub(html, defaultName)
      break
  }
}

// ── PDF via hidden BrowserWindow ──

async function convertToPdf(html: string, defaultName: string): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { javascript: false } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
    })

    const result = await dialog.showSaveDialog(getParentWindow()!, {
      defaultPath: `${defaultName}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return

    const fs = await import('fs/promises')
    await fs.writeFile(result.filePath, pdfBuffer)
  } finally {
    win.destroy()
  }
}

// ── DOCX via html-docx-js ──

async function convertToDocx(html: string, defaultName: string): Promise<void> {
  const htmlDocx = await import('html-docx-js')
  const blob = htmlDocx.asBlob(html)

  const result = await dialog.showSaveDialog(getParentWindow()!, {
    defaultPath: `${defaultName}.docx`,
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  })
  if (result.canceled || !result.filePath) return

  const fs = await import('fs/promises')
  const out = Buffer.isBuffer(blob) ? blob : Buffer.from(await blob.arrayBuffer())
  await fs.writeFile(result.filePath, out)
}

// ── ePub via epub-gen-memory ──

async function convertToEpub(html: string, defaultName: string): Promise<void> {
  const { default: epub } = await import('epub-gen-memory')
  const epubBuffer = await epub(
    { title: defaultName, author: 'Git Suite Export' },
    [{ title: defaultName, content: html }],
  )

  const result = await dialog.showSaveDialog(getParentWindow()!, {
    defaultPath: `${defaultName}.epub`,
    filters: [{ name: 'ePub Book', extensions: ['epub'] }],
  })
  if (result.canceled || !result.filePath) return

  const fs = await import('fs/promises')
  await fs.writeFile(result.filePath, epubBuffer)
}

// ── Repo ZIP Download ──

export async function downloadRepoZip(
  owner: string,
  name: string,
  downloadFolder: string,
  token: string | null
): Promise<string> {
  const fs = await import('fs')
  const fsp = await import('fs/promises')
  const path = await import('path')

  // Ensure download directory exists
  if (!fs.existsSync(downloadFolder)) {
    await fsp.mkdir(downloadFolder, { recursive: true })
  }

  const url = `https://api.github.com/repos/${owner}/${name}/zipball`
  const res = await fetch(url, {
    headers: githubHeaders(token),
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(`GitHub zipball request failed: ${res.status} ${res.statusText}`)
  }

  // Extract filename from Content-Disposition header (GitHub includes commit SHA)
  const disposition = res.headers.get('content-disposition')
  let filename = `${owner}-${name}.zip`
  if (disposition) {
    const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i)
    if (match?.[1]) {
      filename = decodeURIComponent(match[1].replace(/"/g, ''))
      if (!filename.endsWith('.zip')) filename += '.zip'
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  const filePath = path.join(downloadFolder, filename)
  await fsp.writeFile(filePath, buffer)
  return filePath
}

// ── Repo-level Markdown Conversion ──

export async function downloadRepoConverted(
  owner: string,
  name: string,
  format: 'pdf' | 'docx' | 'epub',
): Promise<void> {
  const token = getToken() ?? null

  // Resolve default branch and fetch full tree
  const { getDefaultBranch, getRepoTree, getBlobBySha } = await import('../github')
  const branch = await getDefaultBranch(token, owner, name)

  let tree: { path: string; type: string; sha: string }[]
  try {
    tree = await getRepoTree(token, owner, name, branch)
  } catch (err) {
    if (err instanceof Error && err.message.includes('truncated')) {
      const { dialog } = await import('electron')
      dialog.showErrorBox(
        'Repo too large',
        'This repo is too large for full conversion. Use the Files tab to convert individual files or folders.',
      )
      return
    }
    throw err
  }

  // Collect markdown blobs
  const mdEntries = tree
    .filter(e => e.type === 'blob' && isMarkdown(e.path))
    .sort((a, b) => {
      // README files first
      const aIsReadme = /^(.*\/)?readme(\.[^/]+)?$/i.test(a.path)
      const bIsReadme = /^(.*\/)?readme(\.[^/]+)?$/i.test(b.path)
      if (aIsReadme && !bIsReadme) return -1
      if (!aIsReadme && bIsReadme) return 1
      return a.path.localeCompare(b.path)
    })

  if (mdEntries.length === 0) {
    const { dialog } = await import('electron')
    dialog.showErrorBox('No markdown found', 'This repo contains no markdown files to convert.')
    return
  }

  // Fetch and stitch content
  const parts: string[] = []
  for (const entry of mdEntries) {
    const blob = await getBlobBySha(token, owner, name, entry.sha)
    parts.push(blob.content)
  }
  const markdownContent = parts.join('\n\n---\n\n')

  const { marked } = await import('marked')
  const html = await marked.parse(markdownContent)
  const styledHtml = wrapHtml(html, `${owner}-${name}`)

  switch (format) {
    case 'pdf':
      await convertToPdf(styledHtml, `${owner}-${name}`)
      break
    case 'docx':
      await convertToDocx(styledHtml, `${owner}-${name}`)
      break
    case 'epub':
      await convertToEpub(html, `${owner}-${name}`)
      break
  }
}

// ── Bookmark Export for Awesome Lists ──

export async function exportBookmarks(owner: string, name: string): Promise<void> {
  const token = getToken() ?? null
  const { getDefaultBranch, getRepoTree, getBlobBySha } = await import('../github')
  const branch = await getDefaultBranch(token, owner, name)

  let tree: { path: string; type: string; sha: string }[]
  try {
    tree = await getRepoTree(token, owner, name, branch)
  } catch (err) {
    if (err instanceof Error && err.message.includes('truncated')) {
      const { dialog } = await import('electron')
      dialog.showErrorBox('Repo too large', 'This repo is too large for bookmark export. Try a smaller repo.')
      return
    }
    throw err
  }

  const mdEntries = tree
    .filter(e => e.type === 'blob' && isMarkdown(e.path))
    .sort((a, b) => {
      const aIsReadme = /^(.*\/)?readme(\.[^/]+)?$/i.test(a.path)
      const bIsReadme = /^(.*\/)?readme(\.[^/]+)?$/i.test(b.path)
      if (aIsReadme && !bIsReadme) return -1
      if (!aIsReadme && bIsReadme) return 1
      return a.path.localeCompare(b.path)
    })

  if (mdEntries.length === 0) {
    const { dialog } = await import('electron')
    dialog.showErrorBox('No markdown found', 'This repo contains no markdown files to extract bookmarks from.')
    return
  }

  // Parse markdown with marked lexer to extract links
  const { marked } = await import('marked')
  const folders: Map<string, { text: string; url: string }[]> = new Map()
  let currentHeading = name // default folder name

  for (const entry of mdEntries) {
    const blob = await getBlobBySha(token, owner, name, entry.sha)
    const tokens = marked.lexer(blob.content)
    walkTokens(tokens, (token) => {
      if (token.type === 'heading') {
        currentHeading = token.text ?? ''
      }
      if (token.type === 'link') {
        let url = token.href
        // Convert relative URLs to absolute GitHub URLs
        if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('#')) {
          url = `https://github.com/${owner}/${name}/blob/${branch}/${url}`
        }
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          if (!folders.has(currentHeading)) folders.set(currentHeading, [])
          folders.get(currentHeading)!.push({ text: token.text || url, url })
        }
      }
    })
  }

  // Generate Netscape bookmark HTML
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `  <DT><H3>${escapeHtml(`${owner}/${name}`)}</H3>`,
    '  <DL><p>',
  ]

  for (const [heading, links] of folders) {
    lines.push(`    <DT><H3>${escapeHtml(heading)}</H3>`)
    lines.push('    <DL><p>')
    for (const link of links) {
      lines.push(`      <DT><A HREF="${escapeHtml(link.url)}">${escapeHtml(link.text)}</A>`)
    }
    lines.push('    </DL><p>')
  }

  lines.push('  </DL><p>')
  lines.push('</DL><p>')

  const bookmarkHtml = lines.join('\n')

  const { dialog } = await import('electron')
  const result = await dialog.showSaveDialog(getParentWindow()!, {
    defaultPath: `${owner}-${name}-bookmarks.html`,
    filters: [{ name: 'HTML Bookmark File', extensions: ['html'] }],
  })
  if (result.canceled || !result.filePath) return

  const fs = await import('fs/promises')
  await fs.writeFile(result.filePath, bookmarkHtml, 'utf-8')
}

// Walk marked tokens recursively (handles nested tokens like list items containing links)
function walkTokens(
  tokens: { type: string; text?: string; href?: string; depth?: number; tokens?: unknown[]; items?: unknown[] }[],
  callback: (token: { type: string; text?: string; href?: string; depth?: number }) => void,
): void {
  for (const token of tokens) {
    callback(token)
    if ('tokens' in token && Array.isArray(token.tokens)) {
      walkTokens(token.tokens as typeof tokens, callback)
    }
    if ('items' in token && Array.isArray(token.items)) {
      walkTokens(token.items as typeof tokens, callback)
    }
  }
}

// ── Top-Level Folder Listing ──

export async function getTopLevelFolders(owner: string, name: string): Promise<string[]> {
  const token = getToken() ?? null
  const { getDefaultBranch, getBranch, getTreeBySha } = await import('../github')
  const branch = await getDefaultBranch(token, owner, name)
  const { rootTreeSha } = await getBranch(token, owner, name, branch)
  const entries = await getTreeBySha(token, owner, name, rootTreeSha)
  return entries.filter(e => e.type === 'tree').map(e => e.path)
}

// ── Helpers ──

/** Fetch a tree with ?recursive=1 so nested subdirectories are included. */
async function getRecursiveTree(
  token: string | null,
  owner: string,
  name: string,
  treeSha: string,
): Promise<{ path: string; type: string; sha: string }[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`,
    { headers: githubHeaders(token) },
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json() as { tree: { path: string; type: string; sha: string }[]; truncated: boolean }
  if (data.truncated) {
    throw new Error('Folder tree is too large (truncated). Try downloading a smaller folder.')
  }
  return data.tree
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrapHtml(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1f2328; }
    h1, h2, h3 { border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 85%; background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d9e0; color: #636c76; margin: 0; padding: 0 1em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d9e0; padding: 6px 13px; }
    th { background: #f6f8fa; font-weight: 600; }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid #d1d9e0; margin: 2em 0; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

async function resolveTreeSha(
  token: string | null,
  owner: string,
  name: string,
  rootSha: string,
  path: string
): Promise<string | null> {
  if (!path) return rootSha
  const parts = path.split('/')
  let currentSha = rootSha
  for (const part of parts) {
    const entries = await getTreeBySha(token, owner, name, currentSha)
    const match = entries.find(e => e.path === part && e.type === 'tree')
    if (!match) return null
    currentSha = match.sha
  }
  return currentSha
}
