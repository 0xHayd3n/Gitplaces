import { describe, it, expect, vi } from 'vitest'
import { fetchFileTree, fetchRepoFiles, fetchManifest } from './github-files'

vi.mock('../providers/github', () => ({
  getRepoTree: vi.fn(),
  getFileContent: vi.fn(),
}))

import { getRepoTree, getFileContent } from '../providers/github'

const mockGetRepoTree = vi.mocked(getRepoTree)
const mockGetFileContent = vi.mocked(getFileContent)

describe('fetchFileTree', () => {
  it('returns file paths from tree', async () => {
    mockGetRepoTree.mockResolvedValue([
      { path: 'src/index.ts', type: 'blob', sha: 'sha-index' },
      { path: 'src', type: 'tree', sha: 'sha-src' },
      { path: 'package.json', type: 'blob', sha: 'sha-pkg' },
    ])
    const result = await fetchFileTree('tok', 'owner', 'repo', 'main')
    expect(result).toEqual(['src/index.ts', 'package.json'])
  })

  it('returns empty array on truncated tree error', async () => {
    mockGetRepoTree.mockRejectedValue(new Error('Repo tree too large (GitHub truncated the response)'))
    const result = await fetchFileTree('tok', 'owner', 'repo', 'main')
    expect(result).toEqual([])
  })

  it('returns empty array on API error', async () => {
    mockGetRepoTree.mockRejectedValue(new Error('GitHub API error: 403'))
    const result = await fetchFileTree('tok', 'owner', 'repo', 'main')
    expect(result).toEqual([])
  })
})

describe('fetchRepoFiles', () => {
  it('fetches multiple files in parallel', async () => {
    mockGetFileContent.mockImplementation(async (_, __, ___, p) => {
      if (p === 'src/index.ts') return 'export const foo = 1'
      if (p === 'package.json') return '{"name":"test"}'
      return null
    })
    const result = await fetchRepoFiles('tok', 'owner', 'repo', ['src/index.ts', 'package.json'])
    expect(result.get('src/index.ts')).toBe('export const foo = 1')
    expect(result.get('package.json')).toBe('{"name":"test"}')
  })

  it('skips files that return null', async () => {
    mockGetFileContent.mockResolvedValue(null)
    const result = await fetchRepoFiles('tok', 'owner', 'repo', ['missing.ts'])
    expect(result.size).toBe(0)
  })

  it('skips files that throw errors', async () => {
    mockGetFileContent.mockRejectedValue(new Error('403'))
    const result = await fetchRepoFiles('tok', 'owner', 'repo', ['forbidden.ts'])
    expect(result.size).toBe(0)
  })

  it('enforces max 15 file limit', async () => {
    mockGetFileContent.mockResolvedValue('content')
    const paths = Array.from({ length: 20 }, (_, i) => `file${i}.ts`)
    const result = await fetchRepoFiles('tok', 'owner', 'repo', paths)
    expect(mockGetFileContent).toHaveBeenCalledTimes(15)
  })
})

describe('fetchManifest', () => {
  it('detects and fetches package.json', async () => {
    mockGetFileContent.mockResolvedValue('{"name":"test"}')
    const result = await fetchManifest('tok', 'owner', 'repo', ['src/index.ts', 'package.json'])
    expect(result).toEqual({ filename: 'package.json', content: '{"name":"test"}' })
    expect(mockGetFileContent).toHaveBeenCalledWith('tok', 'owner', 'repo', 'package.json')
  })

  it('returns null when no manifest in tree', async () => {
    const result = await fetchManifest('tok', 'owner', 'repo', ['README.md', 'Makefile'])
    expect(result).toBeNull()
    expect(mockGetFileContent).not.toHaveBeenCalled()
  })

  it('returns null when fetch fails', async () => {
    mockGetFileContent.mockResolvedValue(null)
    const result = await fetchManifest('tok', 'owner', 'repo', ['package.json'])
    expect(result).toBeNull()
  })
})
