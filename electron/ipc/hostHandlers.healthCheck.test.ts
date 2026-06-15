// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } },
  app: { getPath: () => '/tmp/test' },
}))
vi.mock('../githubLoginPopup', () => ({ openLoginPopup: vi.fn(), closeLoginPopup: vi.fn() }))
vi.mock('../store', () => ({ setGitHubUser: vi.fn(), clearGitHubUser: vi.fn() }))
vi.mock('../db', () => ({ getDb: () => ({ prepare: () => ({ run: vi.fn() }) }) }))
vi.mock('../services/topicCacheService', () => ({ initTopicCache: vi.fn() }))
vi.mock('../services/deviceFlowState', () => ({ getDeviceFlowAbort: vi.fn(), setDeviceFlowAbort: vi.fn() }))

const listHostsMock = vi.fn()
vi.mock('../providers/hostConfig', () => ({
  listHosts: () => listHostsMock(),
  getHost: vi.fn(),
  addHost: vi.fn(),
  removeHost: vi.fn(),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { registerHostHandlers } from './hostHandlers'

registerHostHandlers()

describe('hosts:healthCheck', () => {
  beforeEach(() => {
    listHostsMock.mockReset()
    mockFetch.mockReset()
  })

  it('skips GitHub and pings only GitLab + Gitea hosts', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gh:api.github.com', type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub', addedAt: '' },
      { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com', addedAt: '' },
      { id: 'gt:codeberg.org', type: 'gitea', baseUrl: 'https://codeberg.org', label: 'Codeberg', addedAt: '' },
    ])
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ version: '17.0.0' }),
      headers: { get: () => null },
    })

    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean }>
    expect(out['gh:api.github.com']).toEqual({ ok: true })
    expect(out['gl:gitlab.com']).toEqual({ ok: true })
    expect(out['gt:codeberg.org']).toEqual({ ok: true })
    // GitHub not pinged
    const urls = mockFetch.mock.calls.map(c => c[0])
    expect(urls).toContain('https://gitlab.com/api/v4/version')
    expect(urls).toContain('https://codeberg.org/api/v1/version')
    expect(urls).not.toContain('https://api.github.com')
  })

  it('reports a per-host error when a host is unreachable', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gl:gitlab.acme.com', type: 'gitlab', baseUrl: 'https://gitlab.acme.com', label: 'Acme', addedAt: '' },
    ])
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })),
    )
    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean; error?: string }>
    expect(out['gl:gitlab.acme.com'].ok).toBe(false)
    expect(out['gl:gitlab.acme.com'].error).toMatch(/could not reach/i)
  })

  it('reports a TLS error on a self-signed cert host', async () => {
    listHostsMock.mockReturnValue([
      { id: 'gt:gitea.acme.com', type: 'gitea', baseUrl: 'https://gitea.acme.com', label: 'Acme', addedAt: '' },
    ])
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })),
    )
    const out = await handlers.get('hosts:healthCheck')!({}) as Record<string, { ok: boolean; error?: string }>
    expect(out['gt:gitea.acme.com'].ok).toBe(false)
    expect(out['gt:gitea.acme.com'].error).toMatch(/TLS handshake failed/i)
  })

  it('returns an empty object when no hosts are configured', async () => {
    listHostsMock.mockReturnValue([])
    const out = await handlers.get('hosts:healthCheck')!({})
    expect(out).toEqual({})
  })
})
