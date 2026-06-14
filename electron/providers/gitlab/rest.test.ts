// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  gitlabHeaders,
  getCurrentUser,
  getProject,
  searchProjects,
  getReadme,
  getReleases,
  getBranch,
  getTreeBySha,
  getBlobBySha,
  getRawFileBytes,
  getFileContent,
  starProject,
  unstarProject,
  getServerVersion,
} from './rest'

const BASE = 'https://gitlab.com'

function makeResponse(body: unknown, headers: Record<string, string> = {}, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 401),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

describe('gitlabHeaders', () => {
  it('uses PRIVATE-TOKEN when a token is supplied', () => {
    expect(gitlabHeaders('tok')).toEqual(expect.objectContaining({ 'PRIVATE-TOKEN': 'tok' }))
  })
  it('omits the token header when null', () => {
    expect(gitlabHeaders(null)).not.toHaveProperty('PRIVATE-TOKEN')
  })
})

describe('getCurrentUser', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /api/v4/user and returns the GitLab user payload', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 17, username: 'alice', name: 'Alice', avatar_url: 'https://x/a.png', web_url: 'https://gitlab.com/alice',
    }))
    const user = await getCurrentUser(BASE, 'tok')
    expect(user.username).toBe('alice')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/user',
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'tok' }) }),
    )
  })
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({ message: 'unauthorized' }, {}, false, 401))
    await expect(getCurrentUser(BASE, 'tok')).rejects.toThrow(/GitLab API error: 401/)
  })
})

describe('getServerVersion', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { version, revision } on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ version: '16.10.0-pre', revision: 'b93c103' }))
    const v = await getServerVersion(BASE)
    expect(v!.version).toBe('16.10.0-pre')
    expect(mockFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/version', expect.any(Object))
  })
  it('returns null when the response is not JSON or has no version field', async () => {
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

describe('getProject', () => {
  beforeEach(() => mockFetch.mockReset())
  it('encodes the owner/name slug and requests license + statistics', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      id: 42, path_with_namespace: 'gitlab-org/gitlab', path: 'gitlab', name: 'GitLab',
      default_branch: 'master', archived: false,
      namespace: { id: 1, name: 'GitLab.org', path: 'gitlab-org', kind: 'group', full_path: 'gitlab-org', avatar_url: '' },
      star_count: 1, forks_count: 1, open_issues_count: 0, topics: [],
      description: null, web_url: '', created_at: '', last_activity_at: '', updated_at: '',
      visibility: 'public',
    }))
    await getProject(BASE, 'tok', 'gitlab-org', 'gitlab')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab?license=true&statistics=true',
      expect.any(Object),
    )
  })
})

describe('searchProjects', () => {
  beforeEach(() => mockFetch.mockReset())
  it('builds the search URL with sort+order+page params', async () => {
    mockFetch.mockResolvedValue(makeResponse([]))
    await searchProjects(BASE, 'tok', 'rust', 20, 'stars', 'desc', 2)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects')
    expect(call).toContain('search=rust')
    expect(call).toContain('order_by=star_count')
    expect(call).toContain('sort=desc')
    expect(call).toContain('page=2')
    expect(call).toContain('per_page=20')
  })
  it('maps GitHub-style sort=updated to GitLab order_by=last_activity_at', async () => {
    mockFetch.mockResolvedValue(makeResponse([]))
    await searchProjects(BASE, 'tok', 'rust', 20, 'updated', 'desc', 1)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('order_by=last_activity_at')
  })
  it('returns [] when GitLab errors out (parity with GitHub 422 behavior)', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: 'bad query' }, {}, false, 400))
    expect(await searchProjects(BASE, 'tok', '!!!', 20, 'stars', 'desc', 1)).toEqual([])
  })
})

describe('getReadme', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded README when README.md exists', async () => {
    const content = Buffer.from('# hello\n').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))            // getProject for default branch
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))       // files/README.md
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('# hello\n')
  })
  it('falls back across README, README.md, readme.md when earlier names 404', async () => {
    const content = Buffer.from('plain readme').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))                    // README.md
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))       // README
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBe('plain readme')
  })
  it('returns null when no README variant exists', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    const out = await getReadme(BASE, 'tok', 'alice', 'demo')
    expect(out).toBeNull()
  })
})

describe('getReleases', () => {
  beforeEach(() => mockFetch.mockReset())
  it('fetches /releases?per_page=100 and returns the array', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { tag_name: 'v1.0.0', name: 'One', released_at: '2026-01-01T00:00:00Z', description: 'first', upcoming_release: false, assets: { links: [{ name: 'src.tar', url: 'https://x/y' }] } },
    ]))
    const rels = await getReleases(BASE, 'tok', 'alice', 'demo')
    expect(rels).toHaveLength(1)
    expect(rels[0].tag_name).toBe('v1.0.0')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/releases?per_page=100')
  })
})

describe('getBranch', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { commitSha, rootTreeSha: commit.id } since GitLab tree access keys off commit sha', async () => {
    mockFetch.mockResolvedValue(makeResponse({ name: 'main', commit: { id: 'sha-xyz', parent_ids: [] } }))
    const r = await getBranch(BASE, 'tok', 'alice', 'demo', 'main')
    expect(r.commitSha).toBe('sha-xyz')
    expect(r.rootTreeSha).toBe('sha-xyz')
  })
})

describe('getRawFileBytes', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /repository/files/{path}/raw?ref=...', async () => {
    mockFetch.mockResolvedValue(makeResponse('hello', { 'content-type': 'application/octet-stream' }))
    const buf = await getRawFileBytes(BASE, 'tok', 'alice', 'demo', 'main', 'src/x.ts')
    expect(buf).toBeInstanceOf(Buffer)
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/repository/files/src%2Fx.ts/raw?ref=main')
  })
})

describe('getBlobBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns { content, rawBase64, size } from blobs/{sha}', async () => {
    const rawBase64 = Buffer.from('blob').toString('base64')
    mockFetch.mockResolvedValue(makeResponse({ size: 4, encoding: 'base64', content: rawBase64, sha: 'sha-xyz' }))
    const out = await getBlobBySha(BASE, 'tok', 'alice', 'demo', 'sha-xyz')
    expect(out.size).toBe(4)
    expect(out.rawBase64).toBe(rawBase64)
    expect(out.content).toBe('blob')
  })
})

describe('starProject / unstarProject', () => {
  beforeEach(() => mockFetch.mockReset())
  it('star posts to /projects/:id/star', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 201))
    await starProject(BASE, 'tok', 'alice', 'demo')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gitlab.com/api/v4/projects/alice%2Fdemo/star')
    expect((init as { method: string }).method).toBe('POST')
  })
  it('unstar posts to /projects/:id/unstar', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, {}, true, 201))
    await unstarProject(BASE, 'tok', 'alice', 'demo')
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gitlab.com/api/v4/projects/alice%2Fdemo/unstar')
  })
})

describe('getTreeBySha', () => {
  beforeEach(() => mockFetch.mockReset())
  it('hits /repository/tree?ref={treeSha}&recursive=true&per_page=100', async () => {
    mockFetch.mockResolvedValue(makeResponse([
      { id: 'sha-a', name: 'README.md', type: 'blob', path: 'README.md', mode: '100644' },
    ]))
    const entries = await getTreeBySha(BASE, 'tok', 'alice', 'demo', 'sha-root')
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('README.md')
    expect(entries[0].type).toBe('blob')
    const call = mockFetch.mock.calls[0][0] as string
    expect(call).toContain('/api/v4/projects/alice%2Fdemo/repository/tree?ref=sha-root&recursive=true&per_page=100')
  })
})

describe('getFileContent', () => {
  beforeEach(() => mockFetch.mockReset())
  it('returns the decoded file content', async () => {
    const content = Buffer.from('const x = 1\n').toString('base64')
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({ encoding: 'base64', content }))
    const out = await getFileContent(BASE, 'tok', 'alice', 'demo', 'src/x.ts')
    expect(out).toBe('const x = 1\n')
  })
  it('returns null on 404', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(makeResponse({}, {}, false, 404))
    expect(await getFileContent(BASE, 'tok', 'alice', 'demo', 'nope.ts')).toBeNull()
  })
})
