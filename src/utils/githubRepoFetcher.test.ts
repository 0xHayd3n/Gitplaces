import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reset module-level cache between tests by re-importing fresh each time.
// Vitest supports this with vi.resetModules() + dynamic re-import.
beforeEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
})

function mockApi(impl: () => Promise<unknown>) {
  Object.defineProperty(window, 'api', {
    writable: true,
    value: { repo: { get: vi.fn(impl) } },
  })
}

// Re-import after reset so we always get a fresh module cache
async function freshImport() {
  const mod = await import('./githubRepoFetcher')
  return mod
}

describe('fetchRepoPreview', () => {
  it('maps IPC SavedRepo fields to GitHubRepoPreview shape', async () => {
    mockApi(() => Promise.resolve({
      hostNativeId: '1', owner: 'facebook', name: 'react',
      description: 'A JS library', stars: 200000, ownerAvatarUrl: 'https://example.com/avatar.png',
    }))
    const { fetchRepoPreview: fetch } = await freshImport()
    const result = await fetch('facebook', 'react')
    expect(result).toEqual({
      owner: 'facebook',
      name: 'react',
      description: 'A JS library',
      stars: 200000,
      avatarUrl: 'https://example.com/avatar.png',
    })
  })

  it('returns cached result on second call without extra IPC calls', async () => {
    const getRepo = vi.fn().mockResolvedValue({
      hostNativeId: '1', owner: 'facebook', name: 'react',
      description: 'A JS library', stars: 100, ownerAvatarUrl: '',
    })
    Object.defineProperty(window, 'api', { writable: true, value: { repo: { get: getRepo } } })
    const { fetchRepoPreview: fetch } = await freshImport()
    await fetch('facebook', 'react')
    await fetch('facebook', 'react')
    expect(getRepo).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent requests — only one IPC call', async () => {
    const getRepo = vi.fn().mockResolvedValue({
      hostNativeId: '1', owner: 'vuejs', name: 'vue',
      description: '', stars: 0, ownerAvatarUrl: '',
    })
    Object.defineProperty(window, 'api', { writable: true, value: { repo: { get: getRepo } } })
    const { fetchRepoPreview: fetch } = await freshImport()
    await Promise.all([fetch('vuejs', 'vue'), fetch('vuejs', 'vue')])
    expect(getRepo).toHaveBeenCalledTimes(1)
  })

  it('returns placeholder when IPC throws', async () => {
    mockApi(() => Promise.reject(new Error('IPC failure')))
    const { fetchRepoPreview: fetch } = await freshImport()
    const result = await fetch('bad', 'repo')
    expect(result).toEqual({ owner: 'bad', name: 'repo', description: '', stars: 0, avatarUrl: '' })
  })

  it('returns placeholder when IPC resolves with null', async () => {
    mockApi(() => Promise.resolve(null))
    const { fetchRepoPreview: fetch } = await freshImport()
    const result = await fetch('nobody', 'nothing')
    expect(result).toEqual({ owner: 'nobody', name: 'nothing', description: '', stars: 0, avatarUrl: '' })
  })

  it('never throws — always resolves', async () => {
    mockApi(() => Promise.reject(new Error('boom')))
    const { fetchRepoPreview: fetch } = await freshImport()
    await expect(fetch('x', 'y')).resolves.toBeDefined()
  })

  it('treats mixed-case owner/name as the same cache key', async () => {
    const getRepo = vi.fn().mockResolvedValue({
      hostNativeId: '1', owner: 'facebook', name: 'react',
      description: '', stars: 0, ownerAvatarUrl: '',
    })
    Object.defineProperty(window, 'api', { writable: true, value: { repo: { get: getRepo } } })
    const { fetchRepoPreview: fetch } = await freshImport()
    await fetch('Facebook', 'React')
    await fetch('facebook', 'react')
    expect(getRepo).toHaveBeenCalledTimes(1)
  })
})

describe('getCachedRepoPreview', () => {
  it('returns undefined before fetch', async () => {
    mockApi(() => Promise.resolve(null))
    const { getCachedRepoPreview: getCache } = await freshImport()
    expect(getCache('unseen', 'repo')).toBeUndefined()
  })

  it('returns the cached value after fetch', async () => {
    mockApi(() => Promise.resolve({
      hostNativeId: '1', owner: 'test', name: 'pkg', description: 'hi', stars: 5, ownerAvatarUrl: '',
    }))
    const { fetchRepoPreview: fetch, getCachedRepoPreview: getCache } = await freshImport()
    await fetch('test', 'pkg')
    expect(getCache('test', 'pkg')).toBeDefined()
    expect(getCache('test', 'pkg')?.description).toBe('hi')
  })
})
