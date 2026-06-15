// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { githubProvider } from './index'

function makeResponse(body: unknown, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  }
}

const REPO_FIXTURE = {
  id: 42, name: 'demo', full_name: 'alice/demo',
  owner: { login: 'alice', avatar_url: 'https://x/a.png' },
  description: 'a demo', homepage: 'https://demo.example', html_url: 'https://github.com/alice/demo',
  language: 'TypeScript', topics: ['typescript', 'cli'],
  license: { spdx_id: 'MIT', key: 'mit', name: 'MIT License', url: null },
  default_branch: 'main', archived: false, size: 12, stargazers_count: 42, forks_count: 5,
  watchers_count: 42, open_issues_count: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-14T22:00:00Z', pushed_at: '2026-06-14T22:00:00Z',
}

describe('GitHubProvider — canonical wrappers', () => {
  beforeEach(() => mockFetch.mockReset())

  it('getRepoNormalized returns canonical Repo', async () => {
    mockFetch.mockResolvedValue(makeResponse(REPO_FIXTURE))
    const r = await githubProvider.getRepoNormalized('tok', 'alice', 'demo')
    expect(r.fullName).toBe('alice/demo')
    expect(r.stars).toBe(42)
    expect(r.forks).toBe(5)
    expect(r.license).toBe('MIT')
    expect(r.homepageUrl).toBe('https://demo.example')
    expect(r.hostType).toBe('github')
  })

  it('searchReposNormalized returns canonical Repo[]', async () => {
    mockFetch.mockResolvedValue(makeResponse({ items: [REPO_FIXTURE] }))
    const rows = await githubProvider.searchReposNormalized('tok', 'rust', 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].fullName).toBe('alice/demo')
    expect(rows[0].license).toBe('MIT')
  })
})
