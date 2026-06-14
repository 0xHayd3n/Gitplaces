// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Capture the registered handler functions so we can call them directly.
type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
  },
  app: { getPath: () => '/tmp/test' },
}))

vi.mock('../githubLoginPopup', () => ({
  openLoginPopup: vi.fn(),
  closeLoginPopup: vi.fn(),
}))
vi.mock('../store', () => ({ setGitHubUser: vi.fn(), clearGitHubUser: vi.fn() }))
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../services/topicCacheService', () => ({ initTopicCache: vi.fn() }))
vi.mock('../services/deviceFlowState', () => ({ getDeviceFlowAbort: vi.fn(), setDeviceFlowAbort: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { registerHostHandlers } from './hostHandlers'

registerHostHandlers()

describe('hosts:probe — GitLab', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true } when /api/v4/version responds with a version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '16.10.0-pre', revision: 'b93c103' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://gitlab.com' })
    expect(out).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/version', expect.any(Object))
  })

  it('hits a self-hosted base URL when given one', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '17.0.0' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    await probe({}, { type: 'gitlab', baseUrl: 'https://gitlab.acme.com/' })
    // Trailing slash gets normalized inside getServerVersion.
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.acme.com/api/v4/version', expect.any(Object))
  })

  it('returns { ok: false } when the server is unreachable', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://nope.example' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a GitLab/i)
  })

  it('returns { ok: false } when the response is not a GitLab version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ unrelated: true }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a GitLab/i)
  })

  it('returns { ok: false } on HTTP error status', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' }) as { ok: boolean }
    expect(out.ok).toBe(false)
  })

  it('still returns ok:true for the GitHub probe of api.github.com', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'github', baseUrl: 'https://api.github.com' })
    expect(out).toEqual({ ok: true })
    // No fetch call made — GitHub branch short-circuits.
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still falls through to "not implemented" for unknown host types', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://codeberg.org' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not implemented/i)
  })
})
