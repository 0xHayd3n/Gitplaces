// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  giteaHeaders,
  getCurrentUser,
  getRepo,
  searchRepos,
  getReadme,
  getReleases,
  getBranch,
  getTreeBySha,
  getBlobBySha,
  getRawFileBytes,
  getFileContent,
  starRepo,
  unstarRepo,
  isRepoStarred,
  getServerVersion,
} from './rest'

const BASE = 'https://codeberg.org'

function makeResponse(body: unknown, headers: Record<string, string> = {}, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 401),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

describe('giteaHeaders', () => {
  it('uses Authorization: token <pat> when a token is supplied', () => {
    expect(giteaHeaders('tok')).toEqual(expect.objectContaining({ Authorization: 'token tok' }))
  })
  it('omits the Authorization header when null', () => {
    expect(giteaHeaders(null)).not.toHaveProperty('Authorization')
  })
})

describe('getCurrentUser', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /api/v1/user and returns the Gitea user payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 17, login: 'alice', full_name: 'Alice', avatar_url: 'https://x/a.png', html_url: 'https://codeberg.org/alice',
    }))
    const user = await getCurrentUser(BASE, 'tok')
    expect(user.login).toBe('alice')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'token tok' }) }),
    )
  })
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'unauthorized' }, {}, false, 401))
    await expect(getCurrentUser(BASE, 'tok')).rejects.toThrow(/Gitea API error: 401/)
  })
})

describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { version } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '1.21.0+gitea-x' }))
    const v = await getServerVersion(BASE)
    expect(v!.version).toBe('1.21.0+gitea-x')
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })
  it('normalizes a trailing slash on the base URL', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '1.22.0' }))
    await getServerVersion('https://codeberg.org/')
    expect(mockFetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/version', expect.any(Object))
  })
  it('returns null when the response is JSON without a version field', async () => {
    mockFetch.mockResolvedValue(makeResponse({ unrelated: true }))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on network failure', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('network')))
    expect(await getServerVersion(BASE)).toBeNull()
  })
  it('returns null on non-ok status', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getServerVersion(BASE)).toBeNull()
  })
})

describe('getRepo', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /api/v1/repos/{owner}/{name}', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 42, full_name: 'alice/demo', name: 'demo', owner: { id: 1, login: 'alice', avatar_url: '', html_url: '' },
      default_branch: 'main', archived: false, stars_count: 1, forks_count: 1, open_issues_count: 0,
      watchers_count: 7, topics: [], description: null, html_url: '', website: '',
      created_at: '', updated_at: '', size: 0,
    }))
    await getRepo(BASE, 'tok', 'alice', 'demo')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo',
      expect.any(Object),
    )
  })
})

describe('searchRepos', () => {
  beforeEach(() => mockFetch.mockReset())
  it('builds /repos/search?q=...&sort=...&order=...&page=... and unwraps the {data} envelope', async () => {
    mockFetch.mockResolvedValue(makeResponse({ data: [], ok: true }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'stars', 'desc', 2)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v1/repos/search')
    expect(call).toContain('q=rust')
    expect(call).toContain('sort=stars')
    expect(call).toContain('order=desc')
    expect(call).toContain('page=2')
    expect(call).toContain('limit=20')
  })
  it('maps sort=stars/updated/forks/created to the canonical Gitea sort tokens', async () => {
    mockFetch.mockResolvedValue(makeResponse({ data: [] }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'updated', 'desc', 1)
    expect(mockFetch.mock.calls[0][0] as string).toContain('sort=updated')
    mockFetch.mockResolvedValue(makeResponse({ data: [] }))
    await searchRepos(BASE, 'tok', 'rust', 20, 'forks', 'desc', 1)
    expect(mockFetch.mock.calls[1][0] as string).toContain('sort=forks')
  })
  it('returns [] when Gitea errors out (parity with GitHub 422 behavior)', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'bad query' }, {}, false, 400))
    expect(await searchRepos(BASE, 'tok', '!!!', 20, 'stars', 'desc', 1)).toEqual([])
  })
  it('returns [] when the {data} envelope is missing', async () => {
    mockFetch.mockResolvedValue(makeResponse({ ok: true }))
    expect(await searchRepos(BASE, 'tok', 'rust', 20, 'stars', 'desc', 1)).toEqual([])
  })
})

describe('getReadme', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded README from /repos/{o}/{n}/readme', async () => {
    const content = Buffer.from('# hello\n').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('# hello\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/readme',
      expect.any(Object),
    )
  })
  it('passes ?ref=... when a ref is supplied', async () => {
    const content = Buffer.from('hi').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    await getReadme(BASE, 'tok', 'alice', 'demo', 'v1.0.0')
    expect(mockFetch.mock.calls[0][0] as string).toContain('?ref=v1.0.0')
  })
  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getReadme(BASE, 'tok', 'alice', 'demo')).toBeNull()
  })
  it('returns null when the response is not base64-encoded', async () => {
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'plain', content: '...' }))
    expect(await getReadme(BASE, 'tok', 'alice', 'demo')).toBeNull()
  })
})

describe('getReleases', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /releases?limit=50 and returns the array', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { tag_name: 'v1.0.0', name: 'One', published_at: '2026-01-01T00:00:00Z', body: 'first', prerelease: false, assets: [{ name: 'src.tar', browser_download_url: 'https://x/y', size: 10, download_count: 3 }] },
    ]))
    const rels = await getReleases(BASE, 'tok', 'alice', 'demo')
    expect(rels).toHaveLength(1)
    expect(rels[0].tag_name).toBe('v1.0.0')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v1/repos/alice/demo/releases?limit=50')
  })
})

describe('getBranch', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { commitSha, rootTreeSha } from the branch payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({ name: 'main', commit: { id: 'sha-xyz' } }))
    const r = await getBranch(BASE, 'tok', 'alice', 'demo', 'main')
    expect(r.commitSha).toBe('sha-xyz')
    // Gitea's tree API takes a sha (commit or tree), and the renderer treats
    // rootTreeSha as an opaque cache key — reuse the commit sha here.
    expect(r.rootTreeSha).toBe('sha-xyz')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/branches/main',
      expect.any(Object),
    )
  })
})

describe('getRawFileBytes', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /raw/{ref}/{path} (ref in path, NOT query)', async () => {
    mockFetch.mockResolvedValue(makeResponse('hello', { 'content-type': 'application/octet-stream' }))
    const buf = await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'main', 'src/x.ts')
    expect(buf).toBeInstanceOf(Buffer)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toBe('https://codeberg.org/api/v1/repos/alice/demo/raw/main/src/x.ts')
  })
  it('URL-encodes ref and path segments individually', async () => {
    mockFetch.mockResolvedValue(makeResponse('x'))
    await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'feat/branch-with-slash', 'dir/file name.ts')
    expect(mockFetch.mock.calls[0][0] as string)
      .toBe('https://codeberg.org/api/v1/repos/alice/demo/raw/feat%2Fbranch-with-slash/dir/file%20name.ts')
  })
})

describe('getBlobBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { content, rawBase64, size } from /git/blobs/{sha}', async () => {
    const rawBase64 = Buffer.from('blob').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ size: 4, encoding: 'base64', content: rawBase64, sha: 'sha-xyz' }))
    const out = await getBlobBySha(BASE, 'tok', 'alice', 'demo', 'sha-xyz')
    expect(out.size).toBe(4)
    expect(out.rawBase64).toBe(rawBase64)
    expect(out.content).toBe('blob')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/git/blobs/sha-xyz',
      expect.any(Object),
    )
  })
})

describe('starRepo / unstarRepo / isRepoStarred', () => {
  beforeEach(() => mockFetch.mockReset())
  it('star PUTs to /user/starred/{owner}/{name}', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 204))
    await starRepo(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://codeberg.org/api/v1/user/starred/alice/demo')
    expect((init as { method: string }).method).toBe('PUT')
  })
  it('unstar DELETEs the same path', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 204))
    await unstarRepo(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://codeberg.org/api/v1/user/starred/alice/demo')
    expect((init as { method: string }).method).toBe('DELETE')
  })
  it('isRepoStarred GETs /user/starred/{owner}/{name} and treats 204 as true, 404 as false', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, {}, true, 204))
    expect(await isRepoStarred(BASE, 'tok', 'alice', 'demo')).toBe(true)
    mockFetch.mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    expect(await isRepoStarred(BASE, 'tok', 'alice', 'demo')).toBe(false)
  })
  it('isRepoStarred returns false when no token is supplied (no auth → not starred)', async () => {
    expect(await isRepoStarred(BASE, null, 'alice', 'demo')).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('getTreeBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /git/trees/{sha}?recursive=true', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      sha: 'sha-root',
      tree: [{ sha: 'sha-a', path: 'README.md', type: 'blob', mode: '100644', size: 12 }],
      truncated: false,
    }))
    const entries = await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('README.md')
    expect(entries[0].type).toBe('blob')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toBe('https://codeberg.org/api/v1/repos/alice/demo/git/trees/sha-root?recursive=true')
  })
  it('returns [] when the response envelope is malformed', async () => {
    mockFetch.mockResolvedValue(makeResponse({ sha: 'sha-root' }))
    expect(await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')).toEqual([])
  })
})

describe('getFileContent', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded file content from /contents/{path}', async () => {
    const content = Buffer.from('const x = 1\n').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    const out = await getFileContent(BASE, 'tok', 'alice', 'demo', 'src/x.ts')
    expect(out).toBe('const x = 1\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://codeberg.org/api/v1/repos/alice/demo/contents/src/x.ts',
      expect.any(Object),
    )
  })
  it('passes ?ref=... when supplied', async () => {
    const content = Buffer.from('hi').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ encoding: 'base64', content }))
    await getFileContent(BASE, 'tok', 'alice', 'demo', 'README.md', 'v1.0.0')
    expect(mockFetch.mock.calls[0][0] as string)
      .toBe('https://codeberg.org/api/v1/repos/alice/demo/contents/README.md?ref=v1.0.0')
  })
  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, false, 404))
    expect(await getFileContent(BASE, 'tok', 'alice', 'demo', 'nope.ts')).toBeNull()
  })
})
