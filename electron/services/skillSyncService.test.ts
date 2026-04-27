// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Database } from 'better-sqlite3'

vi.mock('../github', () => ({
  createRepo: vi.fn(),
  putFileContents: vi.fn(),
  getRepo: vi.fn()
}))

vi.mock('../store', () => ({
  getSyncEnabled: vi.fn(),
  getSyncRepoOwner: vi.fn(),
  setSyncEnabled: vi.fn(),
  setSyncRepoOwner: vi.fn(),
  getToken: vi.fn()
}))

import { createRepo, putFileContents, getRepo } from '../github'
import { getSyncEnabled, getSyncRepoOwner, getToken, setSyncEnabled, setSyncRepoOwner } from '../store'
import { startSkillSyncService, push, setupRepo } from './skillSyncService'

function makeDb(rows: Record<string, unknown> = {}) {
  const stmt = { get: vi.fn(() => rows), run: vi.fn(), all: vi.fn(() => []) }
  return { prepare: vi.fn(() => stmt) } as unknown as Database
}

function makeWin() {
  return { webContents: { send: vi.fn() } } as unknown as BrowserWindow
}

describe('push', () => {
  beforeEach(() => {
    vi.mocked(getSyncEnabled).mockReturnValue(true)
    vi.mocked(getSyncRepoOwner).mockReturnValue('alice')
    vi.mocked(getToken).mockReturnValue('tok')
  })

  it('bails if sync disabled', async () => {
    vi.mocked(getSyncEnabled).mockReturnValue(false)
    startSkillSyncService(makeDb(), makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('bails if no token', async () => {
    vi.mocked(getToken).mockReturnValue(undefined)
    startSkillSyncService(makeDb(), makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('bails if no repoOwner', async () => {
    vi.mocked(getSyncRepoOwner).mockReturnValue(undefined)
    startSkillSyncService(makeDb(), makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).not.toHaveBeenCalled()
  })

  it('calls putFileContents with correct path and no sha on first push', async () => {
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha1' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills', 'ms/vscode.skill.md', 'content',
      expect.any(String), undefined
    )
  })

  it('passes cached sha on subsequent push', async () => {
    const db = makeDb({ github_sha: 'cached' })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'newsha' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(putFileContents).toHaveBeenCalledWith(
      'tok', 'alice', 'gitsuite-skills', 'ms/vscode.skill.md', 'content',
      expect.any(String), 'cached'
    )
  })

  it('marks sync_status failed and sends IPC event on error', async () => {
    const win = makeWin()
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockRejectedValue(new Error('network error'))
    startSkillSyncService(db, win)
    await push('repo-1', 'ms', 'vscode.skill.md', 'content')
    expect(win.webContents.send).toHaveBeenCalledWith(
      'skillSync:syncFailed',
      expect.objectContaining({ filename: 'vscode.skill.md' })
    )
  })

  it('uses sub_skills table when skillType is provided', async () => {
    const db = makeDb({ github_sha: null })
    vi.mocked(putFileContents).mockResolvedValue({ content: { sha: 'sha1' } })
    startSkillSyncService(db, makeWin())
    await push('repo-1', 'ms', 'vscode.components.skill.md', 'content', 'components')
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls as string[][]
    expect(prepareCalls.some(args => args[0].includes('sub_skills'))).toBe(true)
  })
})

describe('setupRepo', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue('tok')
  })

  it('returns repoUrl when repo already exists', async () => {
    vi.mocked(getRepo).mockResolvedValue({ html_url: 'https://github.com/alice/gitsuite-skills' } as Awaited<ReturnType<typeof getRepo>>)
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.repoUrl).toContain('gitsuite-skills')
    expect(createRepo).not.toHaveBeenCalled()
    expect(vi.mocked(setSyncEnabled)).toHaveBeenCalledWith(true)
    expect(vi.mocked(setSyncRepoOwner)).toHaveBeenCalledWith('alice')
  })

  it('creates repo when getRepo throws (404)', async () => {
    vi.mocked(getRepo).mockRejectedValue(new Error('404'))
    vi.mocked(createRepo).mockResolvedValue({ html_url: 'https://github.com/alice/gitsuite-skills' })
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(true)
    expect(createRepo).toHaveBeenCalledWith('tok', 'gitsuite-skills')
    expect(vi.mocked(setSyncEnabled)).toHaveBeenCalledWith(true)
    expect(vi.mocked(setSyncRepoOwner)).toHaveBeenCalledWith('alice')
  })

  it('returns ok:false on createRepo failure', async () => {
    vi.mocked(getRepo).mockRejectedValue(new Error('404'))
    vi.mocked(createRepo).mockRejectedValue(new Error('API error'))
    startSkillSyncService(makeDb(), makeWin())
    const result = await setupRepo('alice')
    expect(result.ok).toBe(false)
  })
})
