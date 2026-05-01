# Repo Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal notes field to the repo detail right panel (above Stats), stored in SQLite and synced to the user's private `gitsuite-skills` GitHub repo.

**Architecture:** New `repo_notes` SQLite table (1:1 with `repos`, keyed on the numeric GitHub repo ID string) persists notes locally. `notesSyncService.ts` — modelled directly on `skillSyncService.ts` — queues background pushes to `notes/{owner}/{repoName}.md` in the private backup repo. `RepoNotes.tsx` renders a click-to-edit tile with 1.5s debounced autosave and `react-markdown` preview; it sits above the Stats tile in the Activities-tab right panel.

**Tech Stack:** Electron + better-sqlite3, React 18 + react-markdown v10 + remark-gfm v4, GitHub Contents API (existing `putFileContents` + new `getFileContentWithSha`), Vitest + @testing-library/react

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `electron/github.ts` | Modify | Add `getFileContentWithSha` — returns content + blob SHA from Contents API |
| `electron/db.ts` | Modify | Add `repo_notes` CREATE TABLE block |
| `electron/services/notesSyncService.ts` | Create | Push/pull notes to/from `gitsuite-skills` private repo |
| `electron/main.ts` | Modify | Import service, start it at app-ready, add 3 IPC handlers |
| `electron/preload.ts` | Modify | Expose `window.api.notes.{get, set, pullFromGitHub}` |
| `src/components/RepoNotes.tsx` | Create | Self-contained notes tile: click-to-edit, autosave, markdown preview |
| `src/components/RepoNotes.test.tsx` | Create | 7 vitest tests covering mount, preview, edit interactions, pull logic |
| `src/styles/globals.css` | Modify | Add `.repo-notes-*` CSS classes |
| `src/views/RepoDetail.tsx` | Modify | Import + insert `<RepoNotes>` above Stats tile |

---

## Tasks

### Task 1: `electron/github.ts` — Add `getFileContentWithSha`

**Files:**
- Modify: `electron/github.ts` (insert after `getFileContent`, which ends at line 655)

The existing `getFileContent` decodes base64 but discards the blob SHA. This new helper returns both, which `notesSyncService` needs to update notes files without a 409 conflict.

- [ ] **Step 1: Insert `getFileContentWithSha` after the closing `}` of `getFileContent` (line 655)**

```ts
export async function getFileContentWithSha(
  token: string | null,
  owner: string,
  name: string,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(
    `${BASE}/repos/${owner}/${name}/contents/${path}`,
    { headers: githubHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { content?: string; encoding?: string; sha?: string }
  if (!data.content || data.encoding !== 'base64' || !data.sha) return null
  return {
    content: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8'),
    sha: data.sha,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/github.ts
git commit -m "feat(github): add getFileContentWithSha helper"
```

---

### Task 2: `electron/db.ts` — Add `repo_notes` table

**Files:**
- Modify: `electron/db.ts` (add `db.exec` block after the `engagement_events` block, around line 194)

`CREATE TABLE IF NOT EXISTS` is idempotent — existing installs get the table on next launch with no migration script needed.

- [ ] **Step 1: Insert the table block after the `engagement_events` `db.exec` block**

```ts
  // Repo notes (user's private per-repo notes, synced to gitsuite-skills)
  db.exec(`CREATE TABLE IF NOT EXISTS repo_notes (
    repo_id      TEXT PRIMARY KEY REFERENCES repos(id),
    notes        TEXT NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL DEFAULT 0,
    sync_status  TEXT NOT NULL DEFAULT 'pending',
    synced_at    INTEGER,
    github_sha   TEXT
  )`)
```

- [ ] **Step 2: Commit**

```bash
git add electron/db.ts
git commit -m "feat(db): add repo_notes table"
```

---

### Task 3: `electron/services/notesSyncService.ts` — New sync service

**Files:**
- Create: `electron/services/notesSyncService.ts`

Mirrors `skillSyncService.ts` in structure. Notes are stored as `notes/{owner}/{repoName}.md` in the `gitsuite-skills` private repo (the `SKILLS_BACKUP_REPO` constant imported from `skillSyncService`). The first line of every file is `<!-- updated: {epochMs} -->` — invisible when rendered on GitHub, used for conflict resolution. Timestamp is parsed with `/^<!-- updated: (\d+) -->$/` on line 1.

- [ ] **Step 1: Create the service file**

```ts
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getToken, getSyncEnabled, getSyncRepoOwner } from '../store'
import { putFileContents, getFileContentWithSha } from '../github'
import { SKILLS_BACKUP_REPO } from './skillSyncService'

let _win: BrowserWindow | null = null
let _db: Database.Database | null = null

export function startNotesSyncService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _win = win
}

function formatNoteFile(notes: string, updatedAt: number): string {
  return `<!-- updated: ${updatedAt} -->\n${notes}`
}

function parseUpdatedAt(content: string): number {
  const match = content.split('\n')[0].match(/^<!-- updated: (\d+) -->$/)
  return match ? parseInt(match[1], 10) : 0
}

export async function pushNote(
  repoId: string,
  owner: string,
  repoName: string,
  notes: string,
  updatedAt: number,
): Promise<void> {
  if (!getSyncEnabled()) return
  const token = getToken()
  if (!token) return
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return

  const githubPath = `notes/${owner}/${repoName}.md`
  const content = formatNoteFile(notes, updatedAt)

  const row = _db!.prepare(
    'SELECT github_sha FROM repo_notes WHERE repo_id = ?'
  ).get(repoId) as { github_sha: string | null } | undefined
  const currentSha = row?.github_sha ?? undefined

  try {
    const result = await putFileContents(
      token, repoOwner, SKILLS_BACKUP_REPO, githubPath, content,
      `sync notes for ${owner}/${repoName}`, currentSha
    )
    _db!.prepare(
      'UPDATE repo_notes SET github_sha = ?, synced_at = ?, sync_status = ? WHERE repo_id = ?'
    ).run(result.content.sha, Date.now(), 'synced', repoId)
  } catch {
    _db!.prepare(
      'UPDATE repo_notes SET sync_status = ? WHERE repo_id = ?'
    ).run('failed', repoId)
  }
}

export async function pushAllPendingNotes(): Promise<void> {
  if (!getSyncEnabled()) return
  if (!_db) return

  type NoteRow = { repo_id: string; owner: string; repo_name: string; notes: string; updated_at: number }
  const rows = _db.prepare(`
    SELECT n.repo_id, r.owner, r.name AS repo_name, n.notes, n.updated_at
    FROM repo_notes n JOIN repos r ON r.id = n.repo_id
    WHERE n.sync_status = 'pending' OR n.sync_status = 'failed'
  `).all() as NoteRow[]

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
  for (const row of rows) {
    await pushNote(row.repo_id, row.owner, row.repo_name, row.notes, row.updated_at)
    await delay(250)
  }
}

export async function pullNote(
  repoId: string,
  owner: string,
  repoName: string,
): Promise<{ notes: string; updatedAt: number; sha: string } | null> {
  if (!getSyncEnabled()) return null
  const token = getToken()
  if (!token) return null
  const repoOwner = getSyncRepoOwner()
  if (!repoOwner) return null

  const githubPath = `notes/${owner}/${repoName}.md`
  const remote = await getFileContentWithSha(token, repoOwner, SKILLS_BACKUP_REPO, githubPath)
  if (!remote) return null

  const updatedAt = parseUpdatedAt(remote.content)
  const notes = remote.content.split('\n').slice(1).join('\n')
  return { notes, updatedAt, sha: remote.sha }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/notesSyncService.ts
git commit -m "feat(notes): add notesSyncService"
```

---

### Task 4: `electron/main.ts` — Import, startup, IPC handlers

**Files:**
- Modify: `electron/main.ts:10` (add `getFileContentWithSha` to the existing `./github` import)
- Modify: `electron/main.ts:44` (add notesSyncService import after skillSyncService import)
- Modify: `electron/main.ts:2351` (add `startNotesSyncService` + `pushAllPendingNotes` after `startSkillSyncService`)
- Modify: `electron/main.ts` (add 3 IPC handlers after the `skillSync:getStatus` block, around line 1435)

- [ ] **Step 1: Add `getFileContentWithSha` to the `./github` import on line 10**

Find the existing import line (line 10) that imports from `'./github'` and add `getFileContentWithSha` to the destructured list.

- [ ] **Step 2: Add notesSyncService import after line 44**

```ts
import { startNotesSyncService, pushNote as notesSyncPush, pushAllPendingNotes, pullNote } from './services/notesSyncService'
```

- [ ] **Step 3: Start the service and trigger pending sync at app-ready (after line 2351)**

After `startSkillSyncService(db, mainWindow)`:
```ts
    startNotesSyncService(db, mainWindow)
    if (getSyncEnabled()) void pushAllPendingNotes()
```

- [ ] **Step 4: Add IPC handlers after the `skillSync:getStatus` handler (around line 1435)**

```ts
// ── Notes IPC ────────────────────────────────────────────────
ipcMain.handle('notes:get', (_event, repoId: string) => {
  const db = getDb(app.getPath('userData'))
  const row = db.prepare(
    'SELECT notes, updated_at FROM repo_notes WHERE repo_id = ?'
  ).get(repoId) as { notes: string; updated_at: number } | undefined
  return row ?? null
})

ipcMain.handle('notes:set', async (_event, repoId: string, notes: string) => {
  const db = getDb(app.getPath('userData'))
  const updatedAt = Date.now()
  db.prepare(`
    INSERT INTO repo_notes (repo_id, notes, updated_at, sync_status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(repo_id) DO UPDATE
      SET notes = excluded.notes,
          updated_at = excluded.updated_at,
          sync_status = 'pending'
  `).run(repoId, notes, updatedAt)
  const repo = db.prepare('SELECT owner, name FROM repos WHERE id = ?')
    .get(repoId) as { owner: string; name: string } | undefined
  if (repo) void notesSyncPush(repoId, repo.owner, repo.name, notes, updatedAt)
  return { ok: true }
})

ipcMain.handle('notes:pullFromGitHub', async (_event, repoId: string, owner: string, repoName: string) => {
  const db = getDb(app.getPath('userData'))
  const local = db.prepare('SELECT updated_at FROM repo_notes WHERE repo_id = ?')
    .get(repoId) as { updated_at: number } | undefined

  const remote = await pullNote(repoId, owner, repoName)
  if (!remote) return { ok: true, action: 'no-remote' }

  if (remote.updatedAt > (local?.updated_at ?? 0)) {
    db.prepare(`
      INSERT INTO repo_notes (repo_id, notes, updated_at, sync_status, github_sha)
      VALUES (?, ?, ?, 'synced', ?)
      ON CONFLICT(repo_id) DO UPDATE
        SET notes = excluded.notes,
            updated_at = excluded.updated_at,
            sync_status = 'synced',
            github_sha = excluded.github_sha
    `).run(repoId, remote.notes, remote.updatedAt, remote.sha)
    return { ok: true, action: 'updated', notes: remote.notes }
  }
  return { ok: true, action: 'local-wins' }
})
```

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(notes): add notes IPC handlers and service startup"
```

---

### Task 5: `electron/preload.ts` — Expose notes API

**Files:**
- Modify: `electron/preload.ts` (add `notes` namespace after the `skillSync` block, around line 366)

- [ ] **Step 1: Add `notes` namespace after the closing `},` of `skillSync`**

```ts
  notes: {
    get:            (repoId: string) =>
      ipcRenderer.invoke('notes:get', repoId),
    set:            (repoId: string, notes: string) =>
      ipcRenderer.invoke('notes:set', repoId, notes),
    pullFromGitHub: (repoId: string, owner: string, repoName: string) =>
      ipcRenderer.invoke('notes:pullFromGitHub', repoId, owner, repoName),
  },
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(notes): expose notes API in preload bridge"
```

---

### Task 6: `RepoNotes.tsx` + CSS — UI component (TDD)

**Files:**
- Create: `src/components/RepoNotes.test.tsx`
- Create: `src/components/RepoNotes.tsx`
- Modify: `src/styles/globals.css`

**Props:** `{ repoId: string; owner: string; repoName: string }`

`repoId` is the numeric GitHub ID string (e.g. `'12345'`) — matches `repos.id` in the DB.  
Component checks sync status via `window.api.skillSync.getStatus()` on mount.

- [ ] **Step 1: Write failing tests — create `src/components/RepoNotes.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RepoNotes from './RepoNotes'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockPull = vi.fn()
const mockGetStatus = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = {
    notes: { get: mockGet, set: mockSet, pullFromGitHub: mockPull },
    skillSync: { getStatus: mockGetStatus },
  }
  mockGetStatus.mockResolvedValue({ enabled: false })
  mockGet.mockResolvedValue(null)
  mockPull.mockResolvedValue({ ok: true, action: 'no-remote' })
  mockSet.mockResolvedValue({ ok: true })
})

describe('RepoNotes', () => {
  it('shows empty-state placeholder when no notes exist', async () => {
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('12345'))
    expect(screen.getByText(/Click to add notes/i)).toBeInTheDocument()
  })

  it('renders markdown in preview when notes exist', async () => {
    mockGet.mockResolvedValue({ notes: '**bold text**', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(screen.getByText('bold text')).toBeInTheDocument())
    expect(screen.getByRole('strong')).toBeInTheDocument()
  })

  it('switches to textarea when preview is clicked', async () => {
    mockGet.mockResolvedValue({ notes: 'hello world', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => screen.getByText('hello world'))
    await userEvent.click(screen.getByText('hello world'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('switches to textarea when empty-state placeholder is clicked', async () => {
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => screen.getByText(/Click to add notes/i))
    await userEvent.click(screen.getByText(/Click to add notes/i))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls pullFromGitHub on mount when sync enabled AND note row exists', async () => {
    mockGetStatus.mockResolvedValue({ enabled: true })
    mockGet.mockResolvedValue({ notes: 'hi', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockPull).toHaveBeenCalledWith('12345', 'facebook', 'react'))
  })

  it('does NOT call pullFromGitHub when sync is disabled', async () => {
    mockGetStatus.mockResolvedValue({ enabled: false })
    mockGet.mockResolvedValue({ notes: 'hi', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(mockPull).not.toHaveBeenCalled()
  })

  it('does NOT call pullFromGitHub when no note row exists', async () => {
    mockGetStatus.mockResolvedValue({ enabled: true })
    mockGet.mockResolvedValue(null)
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(mockPull).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify all 7 fail**

```bash
npm test -- --reporter=verbose src/components/RepoNotes.test.tsx
```
Expected: all tests FAIL with "Cannot find module './RepoNotes'"

- [ ] **Step 3: Add `.repo-notes-*` CSS to the end of `src/styles/globals.css`**

```css
/* ── Repo Notes tile ──────────────────────────────────────── */
.repo-notes-tile {
  padding: 12px 14px;
  border-bottom: 1px solid var(--glass-border);
}
.repo-notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.repo-notes-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--t3);
}
.repo-notes-save-status {
  font-size: 9px;
  color: #4ade80;
  opacity: 0.7;
}
.repo-notes-save-status.saving {
  color: var(--t3);
  opacity: 1;
}
.repo-notes-preview {
  min-height: 40px;
  font-size: 11px;
  color: var(--t2);
  line-height: 1.6;
  padding: 7px 8px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  cursor: text;
  transition: border-color 0.15s, background 0.15s;
}
.repo-notes-preview:hover {
  border-color: var(--border2);
  background: rgba(255,255,255,0.04);
}
.repo-notes-preview p  { margin: 0 0 4px; }
.repo-notes-preview ul,
.repo-notes-preview ol { margin: 4px 0; padding-left: 14px; }
.repo-notes-preview li { margin: 2px 0; }
.repo-notes-preview strong { color: var(--t1); }
.repo-notes-preview code {
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}
.repo-notes-empty {
  min-height: 40px;
  font-size: 11px;
  color: var(--t4);
  font-style: italic;
  padding: 7px 8px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  cursor: text;
  transition: border-color 0.15s, background 0.15s;
}
.repo-notes-empty:hover {
  border-color: var(--border2);
  background: rgba(255,255,255,0.04);
}
.repo-notes-textarea {
  width: 100%;
  max-height: 160px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border2);
  border-radius: 6px;
  color: var(--t2);
  font-size: 11px;
  font-family: inherit;
  padding: 7px 8px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  line-height: 1.5;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.15) transparent;
}
.repo-notes-textarea::-webkit-scrollbar       { width: 3px; }
.repo-notes-textarea::-webkit-scrollbar-track { background: transparent; }
.repo-notes-textarea::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 2px;
}
.repo-notes-textarea:focus { border-color: rgba(255,255,255,0.28); }
.repo-notes-edit-hint {
  font-size: 9px;
  color: var(--t4);
  margin-top: 4px;
  text-align: right;
}
```

- [ ] **Step 4: Create `src/components/RepoNotes.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  repoId: string
  owner: string
  repoName: string
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export default function RepoNotes({ repoId, owner, repoName }: Props) {
  const [notes, setNotes] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [row, status] = await Promise.all([
        (window as any).api.notes.get(repoId) as Promise<{ notes: string; updated_at: number } | null>,
        (window as any).api.skillSync.getStatus() as Promise<{ enabled: boolean }>,
      ])
      if (cancelled) return
      setNotes(row?.notes ?? null)
      if (status.enabled && row !== null) {
        const result = await (window as any).api.notes.pullFromGitHub(repoId, owner, repoName) as
          { action: string; notes?: string }
        if (!cancelled && result.action === 'updated' && result.notes !== undefined) {
          setNotes(result.notes)
        }
      }
    })()
    return () => { cancelled = true }
  }, [repoId, owner, repoName])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function handleChange(value: string) {
    setNotes(value)
    setSaveStatus('saving')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      await (window as any).api.notes.set(repoId, value)
      setSaveStatus('saved')
    }, 1500)
  }

  return (
    <div className="repo-notes-tile">
      <div className="repo-notes-header">
        <span className="repo-notes-label">Notes</span>
        {saveStatus === 'saving' && (
          <span className="repo-notes-save-status saving">saving...</span>
        )}
        {saveStatus === 'saved' && (
          <span className="repo-notes-save-status">✓ saved</span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            className="repo-notes-textarea"
            value={notes ?? ''}
            onChange={e => handleChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
          <div className="repo-notes-edit-hint">Click outside to close</div>
        </>
      ) : notes === null || notes === '' ? (
        <div className="repo-notes-empty" onClick={() => setEditing(true)}>
          Click to add notes... (markdown supported)
        </div>
      ) : (
        <div className="repo-notes-preview" onClick={() => setEditing(true)}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the RepoNotes tests — verify all 7 pass**

```bash
npm test -- --reporter=verbose src/components/RepoNotes.test.tsx
```
Expected: all 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoNotes.tsx src/components/RepoNotes.test.tsx src/styles/globals.css
git commit -m "feat(notes): add RepoNotes component with tests and CSS"
```

---

### Task 7: `src/views/RepoDetail.tsx` — Wire up the component

**Files:**
- Modify: `src/views/RepoDetail.tsx:481` area (add import near top)
- Modify: `src/views/RepoDetail.tsx:1166` (insert component inside `.stats-sidebar`)

`repo.id` is the numeric GitHub repo ID string — this is the primary key in `repos` and in `repo_notes`.  
The notes tile is rendered only when `repo` is available, consistent with the Stats tile below it.

- [ ] **Step 1: Add import near the top of `RepoDetail.tsx`, with the other component imports**

```tsx
import RepoNotes from '../components/RepoNotes'
```

- [ ] **Step 2: Insert `<RepoNotes>` as the first child of `.stats-sidebar` (line 1166)**

After `<div className="stats-sidebar">` (line 1166), insert:

```tsx
      {repo && (
        <RepoNotes repoId={repo.id} owner={owner!} repoName={name!} />
      )}
```

The `!` non-null assertions on `owner` and `name` are safe here — `useParams` is typed as `string | undefined` but these params are required by the route definition; the component cannot mount without them.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```
Expected: all tests pass. If `RepoDetail.test.tsx` snapshots break, update them with `npm test -- -u`.

- [ ] **Step 4: Commit**

```bash
git add src/views/RepoDetail.tsx
git commit -m "feat(notes): wire RepoNotes into repo detail right panel"
```
