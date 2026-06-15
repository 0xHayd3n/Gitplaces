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
    expect(out.error).toMatch(/could not reach https:\/\/nope\.example/i)
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

  it('returns { ok: false } on HTTP error status with status code surfaced', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      text: () => Promise.resolve('404 Not Found'),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/HTTP 404/)
  })

  it('still returns ok:true for the GitHub probe of api.github.com', async () => {
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'github', baseUrl: 'https://api.github.com' })
    expect(out).toEqual({ ok: true })
    // No fetch call made — GitHub branch short-circuits.
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still falls through to "not implemented" for genuinely unknown host types', async () => {
    const probe = handlers.get('hosts:probe')!
    // Cast through unknown — the handler accepts any string at runtime; the
    // ProbeInput type narrows to the three known values for callers but the
    // implementation surfaces a clear error if it sees anything else.
    const out = await probe({}, { type: 'unknown' as unknown as 'github', baseUrl: 'https://nope.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not implemented/i)
  })
})

describe('hosts:probe — Gitea', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns { ok: true } when /api/v1/version responds with a version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '1.21.0+gitea-x' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://codeberg.org' })
    expect(out).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })

  it('hits a self-hosted base URL when given one', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '1.22.0' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    await probe({}, { type: 'gitea', baseUrl: 'https://gitea.acme.com/' })
    // Trailing slash gets normalized inside getServerVersion.
    expect(mockFetch).toHaveBeenCalledWith('https://gitea.acme.com/api/v1/version', expect.any(Object))
  })

  it('returns { ok: false } when the server is unreachable', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://nope.example' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/could not reach https:\/\/nope\.example/i)
  })

  it('returns { ok: false } when the response is not a Gitea version JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ unrelated: true }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a Gitea/i)
  })

  it('returns { ok: false } on HTTP error status with status code surfaced', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: () => Promise.resolve({ message: '404 Not Found' }),
      text: () => Promise.resolve('404 Not Found'),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://example.com' }) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/HTTP 404/)
  })
})

describe('hosts:probe — kind-specific surfacing', () => {
  beforeEach(() => mockFetch.mockReset())

  it('surfaces TLS handshake errors with the friendly hint and cert code', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'CERT_HAS_EXPIRED' },
      })),
    )
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://expired.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/TLS handshake failed/i)
    expect(out.error).toMatch(/self-signed cert\? expired\?/i)
    expect(out.error).toMatch(/CERT_HAS_EXPIRED/)
  })

  it('surfaces DNS / refused connections with "Could not reach" + "check the URL" hint', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      })),
    )
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://nope.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/could not reach https:\/\/nope\.example/i)
    expect(out.error).toMatch(/check the URL/i)
    expect(out.error).toMatch(/ENOTFOUND/)
  })

  it('surfaces HTTP errors with status + body excerpt', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Internal Server Error'),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitlab', baseUrl: 'https://broken.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/HTTP 500/)
    expect(out.error).toMatch(/Internal Server Error/)
  })

  it('surfaces JSON-mismatch with the canonical "did not respond as a" message', async () => {
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ html: '<title>not gitea</title>' }),
      headers: { get: () => null },
    })
    const probe = handlers.get('hosts:probe')!
    const out = await probe({}, { type: 'gitea', baseUrl: 'https://wrong.example' }) as { ok: boolean; error: string }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not respond as a Gitea/)
  })
})
