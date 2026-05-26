import { describe, it, expect } from 'vitest'
import { buildVisibleRows } from './model'
import type { TreeEntry } from './types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string, size = 100): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size })

describe('buildVisibleRows', () => {
  it('returns root entries when nothing is expanded', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), file('README.md', 'readme-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'README.md'])
    expect(rows[0]).toMatchObject({ type: 'tree', depth: 0, isExpanded: false })
    expect(rows[1]).toMatchObject({ type: 'blob', depth: 0 })
  })

  it('shows children when a directory is expanded', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha')]],
      ['src-sha', [file('index.ts', 'idx-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha']]),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/index.ts'])
    expect(rows[1].depth).toBe(1)
  })

  it('sorts directories before files within a level', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [file('zzz.md', 'z-sha'), dir('aaa-dir', 'a-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['aaa-dir', 'zzz.md'])
  })

  it('flattens single-child directory chains when flattenEmpty is true', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('a', 'a-sha')]],
      ['a-sha', [dir('b', 'b-sha')]],
      ['b-sha', [file('Foo.java', 'foo-sha'), file('Bar.java', 'bar-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['a', 'a-sha']]),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: true,
    })
    expect(rows[0].path).toBe('a/b')
    expect(rows[0].isFlattened).toBe(true)
    expect(rows[0].flattenedSegments).toEqual(['a', 'b'])
    expect(rows[0].name).toBe('a/b')
  })

  it('search mode "hide" filters out non-matching subtrees', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), dir('docs', 'docs-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
      ['docs-sha', [file('README.md', 'r-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha'], ['docs', 'docs-sha']]),
      searchQuery: 'button',
      searchMode: 'hide',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/Button.tsx'])
  })

  it('search mode "expand" auto-expands ancestor paths of matches', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),  // 'src' NOT in expanded
      searchQuery: 'button',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows.map(r => r.path)).toEqual(['src', 'src/Button.tsx'])
    expect(rows[1].matchRanges).toEqual([[0, 6]])
  })

  it('search mode "collapse" hides directories without matches', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('src', 'src-sha'), dir('docs', 'docs-sha')]],
      ['src-sha', [file('Button.tsx', 'b-sha')]],
      ['docs-sha', [file('README.md', 'r-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map([['src', 'src-sha'], ['docs', 'docs-sha']]),
      searchQuery: 'button',
      searchMode: 'collapse',
      flattenEmpty: false,
    })
    // 'docs' is in expanded, but it has no matching descendants — collapsed.
    expect(rows.map(r => r.path)).toEqual(['docs', 'src', 'src/Button.tsx'])
    expect(rows.find(r => r.path === 'docs')?.isExpanded).toBe(false)
  })

  it('populates ARIA level/posInSet/setSize correctly', () => {
    const treeData = new Map<string, TreeEntry[]>([
      ['root-sha', [dir('a', 'a-sha'), file('b.md', 'b-sha'), file('c.md', 'c-sha')]],
    ])
    const rows = buildVisibleRows({
      rootTreeSha: 'root-sha',
      treeData,
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 3 })
    expect(rows[1]).toMatchObject({ level: 1, posInSet: 2, setSize: 3 })
    expect(rows[2]).toMatchObject({ level: 1, posInSet: 3, setSize: 3 })
  })

  it('returns empty array if rootTreeSha is not in treeData', () => {
    const rows = buildVisibleRows({
      rootTreeSha: 'missing',
      treeData: new Map(),
      expanded: new Map(),
      searchQuery: '',
      searchMode: 'expand',
      flattenEmpty: false,
    })
    expect(rows).toEqual([])
  })
})
