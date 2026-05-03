import { describe, it, expect } from 'vitest'
import { generateVariants } from './variantGenerator'
import type { ParsedComponent } from './componentParser'

function comp(props: ParsedComponent['props']): ParsedComponent {
  return { path: 'X.tsx', name: 'X', props, framework: 'react', renderable: true }
}

describe('generateVariants', () => {
  it('generates one variant per union value when prop name is allowlisted', () => {
    const result = generateVariants(comp([
      { name: 'variant', type: "'a' | 'b' | 'c'", required: false, stringUnion: ['a', 'b', 'c'] },
    ]))
    expect(result).toHaveLength(3)
    expect(result.map(v => v.name)).toEqual(['a', 'b', 'c'])
    expect(result[0].props.variant).toBe('a')
  })

  it('returns empty when no union prop matches the allowlist', () => {
    const result = generateVariants(comp([
      { name: 'foo', type: "'a' | 'b'", required: false, stringUnion: ['a', 'b'] },
    ]))
    expect(result).toEqual([])
  })

  it('uses only the first allowlisted union prop', () => {
    const result = generateVariants(comp([
      { name: 'size',    type: "'sm' | 'md'",     required: false, stringUnion: ['sm', 'md'] },
      { name: 'variant', type: "'a' | 'b' | 'c'", required: false, stringUnion: ['a', 'b', 'c'] },
    ]))
    expect(result).toHaveLength(2)  // size first → 2 variants, not 3
    expect(result.map(v => v.props.size)).toEqual(['sm', 'md'])
  })

  it('caps at 6 variants', () => {
    const result = generateVariants(comp([
      { name: 'variant', type: 'union', required: false,
        stringUnion: ['a','b','c','d','e','f','g','h'] },
    ]))
    expect(result).toHaveLength(6)
  })

  it('returns empty when no union props at all', () => {
    const result = generateVariants(comp([
      { name: 'label', type: 'string', required: true },
    ]))
    expect(result).toEqual([])
  })
})
