// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { getUser, getStarred, startDeviceFlow, pollDeviceToken, getRepo, searchRepos, getReadme, getReleases, getReceivedEvents } from './rest'

function makeResponse(body: unknown, headers: Record<string, string> = {}, ok = true) {
  return {
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

describe('getUser', () => {
  beforeEach(() => mockFetch.mockReset())

  it('fetches /user and returns data', async () => {
    mockFetch.mockResolvedValue(makeResponse({ login: 'alice', avatar_url: 'https://example.com/a.png', public_repos: 42 }))
    const user = await getUser('tok')
    expect(user.login).toBe('alice')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false))
    await expect(getUser('tok')).rejects.toThrow('GitHub API error: 401')
  })
})

describe('getStarred', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns repos from a single page', async () => {
    const repos = [{ starred_at: '2024-01-15T10:00:00Z', repo: { id: 1, name: 'repo1', owner: { login: 'alice' } } }]
    mockFetch.mockResolvedValue(makeResponse(repos))
    const result = await getStarred('tok')
    expect(result).toHaveLength(1)
    expect(result[0].repo.name).toBe('repo1')
    expect(result[0].starred_at).toBe('2024-01-15T10:00:00Z')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/user/starred'),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github.star+json' })
      })
    )
  })

  it('follows Link header to fetch multiple pages', async () => {
    const page1 = [{ starred_at: '2024-01-14T00:00:00Z', repo: { id: 1, name: 'r1', owner: { login: 'a' } } }]
    const page2 = [{ starred_at: '2024-01-13T00:00:00Z', repo: { id: 2, name: 'r2', owner: { login: 'a' } } }]
    mockFetch
      .mockResolvedValueOnce(makeResponse(page1, { Link: '<https://api.github.com/user/starred?page=2>; rel="next"' }))
      .mockResolvedValueOnce(makeResponse(page2))
    const result = await getStarred('tok')
    expect(result).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops after 10 pages', async () => {
    const pageData = [{ starred_at: '2024-01-01T00:00:00Z', repo: { id: 1, name: 'r', owner: { login: 'a' } } }]
    mockFetch.mockResolvedValue(
      makeResponse(pageData, { Link: '<https://api.github.com/user/starred?page=2>; rel="next"' })
    )
    const result = await getStarred('tok')
    expect(mockFetch).toHaveBeenCalledTimes(10)
    expect(result).toHaveLength(10)
  })
})

describe('startDeviceFlow', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns device/user codes on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      device_code: 'dev-code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234',
      expires_in: 900,
      interval: 5,
    }))
    const flow = await startDeviceFlow()
    expect(flow.deviceCode).toBe('dev-code')
    expect(flow.userCode).toBe('ABCD-1234')
    expect(flow.interval).toBe(5)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a helpful error when device flow is disabled', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: 'device_flow_disabled' }))
    await expect(startDeviceFlow()).rejects.toThrow(/Device Flow is not enabled/)
  })

  it('falls back to a constructed verification_uri_complete when omitted', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      device_code: 'dev', user_code: 'A-1',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900, interval: 5,
    }))
    const flow = await startDeviceFlow()
    expect(flow.verificationUriComplete).toContain('user_code=A-1')
  })
})

describe('pollDeviceToken', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns the access token once the user approves', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(makeResponse({ access_token: 'gho_ok' }))
    const token = await pollDeviceToken('dev-code', 0)
    expect(token).toBe('gho_ok')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws when the user denies authorization', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: 'access_denied' }))
    await expect(pollDeviceToken('dev-code', 0)).rejects.toThrow(/denied/)
  })

  it('throws when the device code expires', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: 'expired_token' }))
    await expect(pollDeviceToken('dev-code', 0)).rejects.toThrow(/expired/)
  })
})

describe('getRepo', () => {
  beforeEach(() => mockFetch.mockReset())

  it('fetches /repos/{owner}/{name} and returns data', async () => {
    const repo = { id: 1, name: 'foo', owner: { login: 'alice' } }
    mockFetch.mockResolvedValue(makeResponse(repo))
    const result = await getRepo('tok', 'alice', 'foo')
    expect(result.name).toBe('foo')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/alice/foo',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false))
    await expect(getRepo('tok', 'alice', 'foo')).rejects.toThrow('GitHub API error: 401')
  })
})

describe('searchRepos', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns items from search API', async () => {
    const items = [{ id: 1, name: 'repo1', owner: { login: 'alice' }, stargazers_count: 500 }]
    mockFetch.mockResolvedValue(makeResponse({ items }))
    const result = await searchRepos(null, 'stars:>1000')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('repo1')
  })

  it('omits Authorization when token is null', async () => {
    mockFetch.mockResolvedValue(makeResponse({ items: [] }))
    await searchRepos(null, 'stars:>1000')
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('includes Authorization when token is provided', async () => {
    mockFetch.mockResolvedValue(makeResponse({ items: [] }))
    await searchRepos('tok', 'stars:>1000')
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer tok')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false))
    await expect(searchRepos(null, 'q')).rejects.toThrow('GitHub API error: 401')
  })

  it('returns [] without fetching for an empty query', async () => {
    const result = await searchRepos(null, '')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] without fetching for a whitespace-only query', async () => {
    const result = await searchRepos(null, '   \n\t')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] (not throws) when GitHub responds 422 unprocessable', async () => {
    // GitHub Search returns 422 when a query is too long, has bad qualifier
    // syntax, or otherwise can't be parsed. Surfacing it as an unhandled
    // exception crashes the IPC handler — return empty results instead.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'Validation Failed' }),
      headers: { get: () => null },
    })
    const result = await searchRepos(null, 'some malformed:::query')
    expect(result).toEqual([])
  })
})

describe('getReadme', () => {
  beforeEach(() => mockFetch.mockReset())

  it('base64-decodes content and returns markdown string', async () => {
    const content = Buffer.from('# Hello').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ content, encoding: 'base64' }))
    const result = await getReadme(null, 'alice', 'repo')
    expect(result).toBe('# Hello')
  })

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    const result = await getReadme(null, 'alice', 'repo')
    expect(result).toBeNull()
  })

  it('throws on other non-ok responses', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false))
    await expect(getReadme(null, 'alice', 'repo')).rejects.toThrow('GitHub API error: 401')
  })
})

describe('getReleases', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns releases array', async () => {
    const releases = [{ tag_name: 'v1.0', name: 'Release 1', published_at: '2024-01-01', body: null }]
    mockFetch.mockResolvedValue(makeResponse(releases))
    const result = await getReleases(null, 'alice', 'repo')
    expect(result).toHaveLength(1)
    expect(result[0].tag_name).toBe('v1.0')
  })

  it('omits Authorization when token is null', async () => {
    mockFetch.mockResolvedValue(makeResponse([]))
    await getReleases(null, 'alice', 'repo')
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBeUndefined()
  })
})

describe('getReceivedEvents', () => {
  beforeEach(() => mockFetch.mockReset())

  function makeRawEvent(overrides: Partial<{ id: string; type: string; created_at: string; payload: Record<string, unknown> }> = {}) {
    return {
      id: overrides.id ?? '1',
      type: overrides.type ?? 'WatchEvent',
      actor: { login: 'alice', avatar_url: 'a.png' },
      repo: { name: 'alice/repo' },
      payload: overrides.payload ?? { action: 'started' },
      created_at: overrides.created_at ?? new Date().toISOString(),
    }
  }

  it('returns mapped events from a single page', async () => {
    mockFetch.mockResolvedValue(makeResponse([makeRawEvent({ id: '1', type: 'WatchEvent' })]))
    const result = await getReceivedEvents('tok', 'alice')
    expect(result).toHaveLength(1)
    expect(result[0].repo.full_name).toBe('alice/repo')
    expect(result[0].type).toBe('WatchEvent')
  })

  it('filters out non-high-signal event types', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      makeRawEvent({ id: '1', type: 'PushEvent' }),
      makeRawEvent({ id: '2', type: 'IssueCommentEvent' }),
      makeRawEvent({ id: '3', type: 'WatchEvent' }),
      makeRawEvent({ id: '4', type: 'ForkEvent', payload: { forkee: { full_name: 'bob/repo' } } }),
      makeRawEvent({ id: '5', type: 'ReleaseEvent', payload: { action: 'published', release: { tag_name: 'v1' } } }),
    ]))
    const result = await getReceivedEvents('tok', 'alice')
    expect(result.map(e => e.id).sort()).toEqual(['3', '4', '5'])
  })

  it('keeps merged PRs but drops unmerged closed PRs', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      makeRawEvent({ id: '1', type: 'PullRequestEvent', payload: { action: 'closed', pull_request: { merged: true, title: 't' } } }),
      makeRawEvent({ id: '2', type: 'PullRequestEvent', payload: { action: 'closed', pull_request: { merged: false, title: 't' } } }),
      makeRawEvent({ id: '3', type: 'PullRequestEvent', payload: { action: 'opened', pull_request: { merged: false, title: 't' } } }),
    ]))
    const result = await getReceivedEvents('tok', 'alice')
    expect(result.map(e => e.id)).toEqual(['1'])
  })

  it('follows Link header to fetch multiple pages', async () => {
    const recent = new Date().toISOString()
    const page1 = [makeRawEvent({ id: '1', type: 'WatchEvent', created_at: recent })]
    const page2 = [makeRawEvent({ id: '2', type: 'WatchEvent', created_at: recent })]
    mockFetch
      .mockResolvedValueOnce(makeResponse(page1, { Link: '<https://api.github.com/users/alice/received_events?page=2>; rel="next"' }))
      .mockResolvedValueOnce(makeResponse(page2))
    const result = await getReceivedEvents('tok', 'alice')
    expect(result).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops after 5 pages', async () => {
    const recent = new Date().toISOString()
    mockFetch.mockResolvedValue(
      makeResponse(
        [makeRawEvent({ id: 'r', type: 'WatchEvent', created_at: recent })],
        { Link: '<https://api.github.com/users/alice/received_events?page=99>; rel="next"' },
      )
    )
    await getReceivedEvents('tok', 'alice')
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('stops paginating once a page contains only events older than the cutoff', async () => {
    const fresh = new Date().toISOString()
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    mockFetch
      .mockResolvedValueOnce(makeResponse(
        [makeRawEvent({ id: '1', type: 'WatchEvent', created_at: fresh })],
        { Link: '<https://api.github.com/users/alice/received_events?page=2>; rel="next"' },
      ))
      .mockResolvedValueOnce(makeResponse(
        [makeRawEvent({ id: '2', type: 'WatchEvent', created_at: old })],
        { Link: '<https://api.github.com/users/alice/received_events?page=3>; rel="next"' },
      ))
    const result = await getReceivedEvents('tok', 'alice')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.map(e => e.id)).toEqual(['1'])
  })

  it('stops paginating on an empty page even when a next-link is present', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(
      [],
      { Link: '<https://api.github.com/users/alice/received_events?page=2>; rel="next"' },
    ))
    const result = await getReceivedEvents('tok', 'alice')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('throws when the first page errors', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, {}, false))
    await expect(getReceivedEvents('tok', 'alice')).rejects.toThrow('GitHub API error: 401')
  })

  it('returns first-page data if a later page errors (graceful degradation)', async () => {
    const recent = new Date().toISOString()
    mockFetch
      .mockResolvedValueOnce(makeResponse(
        [makeRawEvent({ id: '1', type: 'WatchEvent', created_at: recent })],
        { Link: '<https://api.github.com/users/alice/received_events?page=2>; rel="next"' },
      ))
      .mockResolvedValueOnce(makeResponse({}, {}, false))
    const result = await getReceivedEvents('tok', 'alice')
    expect(result.map(e => e.id)).toEqual(['1'])
  })
})

describe('getReadme with ref parameter', () => {
  beforeEach(() => mockFetch.mockReset())

  it('appends ?ref= query param when ref is provided', async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ content: Buffer.from('# hello').toString('base64'), encoding: 'base64' })
    )
    await getReadme(null, 'owner', 'repo', 'v7.3.9')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('?ref=v7.3.9'),
      expect.anything()
    )
  })

  it('omits ?ref= when ref is not provided', async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ content: Buffer.from('# hello').toString('base64'), encoding: 'base64' })
    )
    await getReadme(null, 'owner', 'repo')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).not.toContain('?ref=')
  })

  it('returns null on 404 regardless of ref', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const result = await getReadme(null, 'owner', 'repo', 'v1.0.0')
    expect(result).toBeNull()
  })
})

describe('payload type surface', () => {
  it('GitHubRelease carries prerelease flag', () => {
    const r: import('./rest').GitHubRelease = {
      tag_name: 'v1.0.0',
      name: null,
      published_at: new Date().toISOString(),
      body: null,
      assets: [],
      prerelease: true,
    }
    expect(r.prerelease).toBe(true)
  })

  it('ReleaseEvent payload exposes prerelease flag', () => {
    const p: import('./rest').GitHubEventPayload = {
      type: 'ReleaseEvent',
      action: 'published',
      release: { tag_name: 'v2.0.0', name: 'Two', body: null, prerelease: false },
    }
    if (p.type === 'ReleaseEvent') {
      expect(p.release.prerelease).toBe(false)
    }
  })

  it('PullRequestEvent payload exposes number, body, user, base, and head', () => {
    const p: import('./rest').GitHubEventPayload = {
      type: 'PullRequestEvent',
      action: 'closed',
      pull_request: {
        merged: true,
        title: 'Fix it',
        number: 1234,
        body: 'Body markdown',
        user: { login: 'alice', avatar_url: 'https://example.com/a.png' },
        base: { sha: 'aaa', ref: 'main' },
        head: { sha: 'bbb', ref: 'feature' },
      },
    }
    if (p.type === 'PullRequestEvent') {
      expect(p.pull_request.number).toBe(1234)
      expect(p.pull_request.base.sha).toBe('aaa')
      expect(p.pull_request.head.ref).toBe('feature')
    }
  })
})
