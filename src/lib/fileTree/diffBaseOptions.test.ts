import { describe, it, expect } from 'vitest'
import { buildDiffBaseOptions } from './diffBaseOptions'

describe('buildDiffBaseOptions', () => {
  it('maps releases to tag options, capped at 10', () => {
    const releases = Array.from({ length: 15 }, (_, i) => ({ tagName: `v${i}` }))
    const opts = buildDiffBaseOptions(releases, 'main')
    const tagOpts = opts.filter(o => o.ref.type === 'tag')
    expect(tagOpts).toHaveLength(10)
    expect(tagOpts[0]).toEqual({ label: 'vs v0', ref: { type: 'tag', ref: 'v0' } })
  })

  it('omits "vs main" when the current branch is main', () => {
    const labels = buildDiffBaseOptions([], 'main').map(o => o.label)
    expect(labels).not.toContain('vs main')
    expect(labels).toContain('vs master')
  })

  it('omits "vs master" when the current branch is master', () => {
    const labels = buildDiffBaseOptions([], 'master').map(o => o.label)
    expect(labels).toContain('vs main')
    expect(labels).not.toContain('vs master')
  })

  it('includes both branch options for a feature branch', () => {
    const opts = buildDiffBaseOptions([], 'feature')
    expect(opts).toEqual([
      { label: 'vs main', ref: { type: 'branch', ref: 'main' } },
      { label: 'vs master', ref: { type: 'branch', ref: 'master' } },
      { label: 'vs HEAD~5', ref: { type: 'commit', ref: 'feature~5' } },
      { label: 'vs HEAD~25', ref: { type: 'commit', ref: 'feature~25' } },
    ])
  })

  it('always appends HEAD~5 and HEAD~25 commit offsets relative to the branch', () => {
    const opts = buildDiffBaseOptions([{ tagName: 'v1' }], 'main')
    expect(opts).toContainEqual({ label: 'vs HEAD~5', ref: { type: 'commit', ref: 'main~5' } })
    expect(opts).toContainEqual({ label: 'vs HEAD~25', ref: { type: 'commit', ref: 'main~25' } })
  })
})
