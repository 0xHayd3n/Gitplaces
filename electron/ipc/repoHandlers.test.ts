// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: mockHandle },
}))

let db: Database.Database
vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: () => db }
})

const mockEnqueueRepo = vi.fn()
vi.mock('../services/verificationService', () => ({
  enqueueRepo: mockEnqueueRepo,
}))

vi.mock('../services/updateService', () => ({
  checkIsFork: vi.fn().mockResolvedValue(false),
}))

vi.mock('../providers/registry', () => ({
  getProvider: vi.fn().mockReturnValue(null),
  getAnyProvider: vi.fn().mockReturnValue({
    getReleases: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('../providers/tokenStore', () => ({
  getToken: vi.fn().mockReturnValue(null),
}))

describe('repo:save handler', () => {
  beforeEach(async () => {
    db = new Database(':memory:')
    const { initSchema } = await import('../db')
    initSchema(db)
    mockHandle.mockReset()
    mockEnqueueRepo.mockReset()
  })

  afterEach(() => {
    db.close()
  })

  it('enqueues with the native row id after the id has been promoted (not the synthetic owner/name)', async () => {
    // After cascadeRepoId promotes the row, id becomes the real native id ('42'),
    // not the synthetic 'alice/foo' form.
    db.prepare(
      'INSERT INTO repos (id, owner, name, language) VALUES (?, ?, ?, ?)'
    ).run('42', 'alice', 'foo', 'Python')

    const { registerRepoHandlers } = await import('./repoHandlers')
    registerRepoHandlers()

    const saveCall = mockHandle.mock.calls.find(([channel]) => channel === 'repo:save')
    expect(saveCall, 'repo:save handler should be registered').toBeDefined()
    const handler = saveCall![1] as (event: unknown, hostId: string, owner: string, name: string) => Promise<void>

    await handler({}, 'github', 'alice', 'foo')

    expect(mockEnqueueRepo).toHaveBeenCalledWith({
      repoId: '42',
      owner: 'alice',
      name: 'foo',
      language: 'Python',
      priority: 'high',
    })

    // Handler queues a setImmediate for stored_version + is_forked updates.
    // Flush it so the DB stays open while it runs, avoiding unhandled rejections.
    await new Promise<void>(resolve => setImmediate(resolve))
  })
})
