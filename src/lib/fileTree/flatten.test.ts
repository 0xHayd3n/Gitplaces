import { describe, it, expect } from 'vitest'
import { flattenChain } from './flatten'
import type { TreeEntry } from './types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string, size = 100): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size })

describe('flattenChain', () => {
  it('returns no flatten for a directory with multiple children', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), file('README.md', 'r-sha')]],
    ])
    const result = flattenChain('src', 'src-sha', treeData)
    expect(result.segments).toEqual(['src'])
    expect(result.terminalSha).toBe('src-sha')
  })

  it('flattens a single-child chain of directories', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [dir('c', 'c-sha')]],
      ['c-sha', [file('Foo.java', 'foo-sha'), file('Bar.java', 'bar-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b', 'c'])
    expect(result.terminalSha).toBe('c-sha')
  })

  it('stops flattening at the first branching directory', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [dir('c', 'c-sha'), file('side.txt', 'side-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b'])
    expect(result.terminalSha).toBe('b-sha')
  })

  it('does not flatten if the single child is a file', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [file('only.txt', 'only-sha')]],
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a'])
    expect(result.terminalSha).toBe('a-sha')
  })

  it('stops at unloaded directories (terminalSha is the last loaded sha)', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['a-sha', [dir('b', 'b-sha')]],
      // 'b-sha' contents not loaded yet
    ])
    const result = flattenChain('a', 'a-sha', treeData)
    expect(result.segments).toEqual(['a', 'b'])
    expect(result.terminalSha).toBe('b-sha')
  })
})
