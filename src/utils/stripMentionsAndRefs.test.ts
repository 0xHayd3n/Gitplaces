import { describe, it, expect } from 'vitest'
import { stripMentionsAndRefs } from './stripMentionsAndRefs'

describe('stripMentionsAndRefs', () => {
  it('strips bare GitHub issue/PR refs', () => {
    expect(stripMentionsAndRefs('Fixed #1234 and #5678 too.')).toBe('Fixed and too.')
  })

  it('strips bare GitHub mentions', () => {
    expect(stripMentionsAndRefs('Thanks @octocat and @torvalds!')).toBe('Thanks and!')
  })

  it('strips markdown-linked issue/PR refs', () => {
    const input = 'See [#17277](https://github.com/foo/bar/pull/17277) for details.'
    expect(stripMentionsAndRefs(input)).toBe('See for details.')
  })

  it('strips markdown-linked mentions', () => {
    const input = 'By [@octocat](https://github.com/octocat) on launch day.'
    expect(stripMentionsAndRefs(input)).toBe('By on launch day.')
  })

  it('removes parenthesized ref clusters wholesale', () => {
    const input = 'Memory providers shut down cleanly. (#16026, #17213, #16099, #15057)'
    expect(stripMentionsAndRefs(input)).toBe('Memory providers shut down cleanly.')
  })

  it('removes parenthesized markdown-linked ref clusters', () => {
    const input = 'Skill integrations expanded ([#17610](https://github.com/x/y/pull/17610), [#17631](https://github.com/x/y/pull/17631)).'
    expect(stripMentionsAndRefs(input)).toBe('Skill integrations expanded.')
  })

  it('does not strip email addresses', () => {
    expect(stripMentionsAndRefs('Contact support@example.com for help.')).toBe('Contact support@example.com for help.')
  })

  it('does not strip color hex codes', () => {
    expect(stripMentionsAndRefs('Use color #abc or #ff0000ee.')).toBe('Use color #abc or #ff0000ee.')
  })

  it('preserves paragraph structure', () => {
    const input = 'First paragraph.\n\nSecond paragraph (#1, #2).'
    expect(stripMentionsAndRefs(input)).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('handles org/team mentions like @anthropic/foundations', () => {
    expect(stripMentionsAndRefs('cc @anthropic/foundations team')).toBe('cc team')
  })

  it('handles a mix of mentions, refs, and prose', () => {
    const input = 'Big thanks to @alice and @bob for #100, plus [#101](https://github.com/o/r/issues/101) and [#102](https://github.com/o/r/pull/102).'
    expect(stripMentionsAndRefs(input)).toBe('Big thanks to and for, plus and.')
  })

  it('strips an entire Mentions section when it is the last section', () => {
    const input = '# Highlights\n\nMain content.\n\n## Mentions\n\n@user1, @user2 thanks!\n'
    expect(stripMentionsAndRefs(input).trim()).toBe('# Highlights\n\nMain content.')
  })

  it('strips a Contributors section followed by another section', () => {
    const input = '# Notes\n\nFix.\n\n## Contributors\n\nThanks @alice\n\n# Compare\n\nstuff'
    const result = stripMentionsAndRefs(input)
    expect(result).not.toContain('Contributors')
    expect(result).not.toContain('@alice')
    expect(result).toContain('# Notes')
    expect(result).toContain('# Compare')
  })

  it('strips a Special Thanks section', () => {
    const input = '## Changes\n\nA change.\n\n## Special Thanks\n\nLots of love'
    expect(stripMentionsAndRefs(input).trim()).toBe('## Changes\n\nA change.')
  })

  it('strips empty bold wrappers left after stripping mentions', () => {
    expect(stripMentionsAndRefs('Reviewed by **@octocat** and **@torvalds**.')).toBe('Reviewed by and.')
  })

  it('strips empty inline-code and strike wrappers', () => {
    expect(stripMentionsAndRefs('Code: `@user` and ~~@user~~ removed.')).toBe('Code: and removed.')
  })

  it('strips trailing horizontal rules orphaned by section removal', () => {
    const input = '# Highlights\n\nStuff.\n\n---\n\n## Mentions\n\n@users'
    expect(stripMentionsAndRefs(input).trim()).toBe('# Highlights\n\nStuff.')
  })

  it('does not strip headings that merely contain "thanks" within other text', () => {
    const input = '## Bug fixes for the thanks dialog\n\nFix.'
    const result = stripMentionsAndRefs(input)
    expect(result).toContain('Bug fixes for the thanks dialog')
    expect(result).toContain('Fix.')
  })
})
