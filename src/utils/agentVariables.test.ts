import { describe, it, expect } from 'vitest'
import { detectVariables, substituteVariables } from './agentVariables'

describe('detectVariables', () => {
  it('returns an empty array when there are no variables', () => {
    expect(detectVariables('Just a regular body.')).toEqual([])
  })

  it('returns an empty array on an empty body', () => {
    expect(detectVariables('')).toEqual([])
  })

  it('detects a single variable', () => {
    expect(detectVariables('Hello {{name}}!')).toEqual(['name'])
  })

  it('detects multiple distinct variables in order of first appearance', () => {
    expect(detectVariables('{{first}} then {{second}} and {{third}}')).toEqual(['first', 'second', 'third'])
  })

  it('dedupes repeated variables, preserving first-appearance order', () => {
    expect(detectVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(detectVariables('{{ name }} and {{  other  }}')).toEqual(['name', 'other'])
  })

  it('rejects identifiers starting with a digit', () => {
    expect(detectVariables('{{1bad}} {{good}}')).toEqual(['good'])
  })

  it('rejects identifiers containing dashes or spaces', () => {
    expect(detectVariables('{{foo-bar}} {{foo bar}} {{ok_name}}')).toEqual(['ok_name'])
  })

  it('accepts underscores and digits after the first character', () => {
    expect(detectVariables('{{_x}} {{a1}} {{foo_bar_2}}')).toEqual(['_x', 'a1', 'foo_bar_2'])
  })
})

describe('substituteVariables', () => {
  it('replaces a single variable', () => {
    expect(substituteVariables('Hello {{name}}!', { name: 'world' })).toBe('Hello world!')
  })

  it('replaces multiple variables', () => {
    expect(substituteVariables('{{a}} and {{b}}', { a: 'foo', b: 'bar' })).toBe('foo and bar')
  })

  it('replaces all occurrences of the same variable', () => {
    expect(substituteVariables('{{x}} + {{x}} = 2{{x}}', { x: '1' })).toBe('1 + 1 = 21')
  })

  it('leaves missing variables as literal {{var}}', () => {
    expect(substituteVariables('{{a}} and {{b}}', { a: 'foo' })).toBe('foo and {{b}}')
  })

  it('tolerates whitespace inside the braces when substituting', () => {
    expect(substituteVariables('Hi {{ name }} ok', { name: 'sam' })).toBe('Hi sam ok')
  })

  it('ignores stale values for variables not in the body', () => {
    expect(substituteVariables('Hello {{name}}', { name: 'sam', removed: 'x' })).toBe('Hello sam')
  })

  it('returns the body unchanged when values is empty', () => {
    expect(substituteVariables('{{a}} and {{b}}', {})).toBe('{{a}} and {{b}}')
  })

  it('does not substitute when the value is undefined (key absent)', () => {
    expect(substituteVariables('{{a}}', {})).toBe('{{a}}')
  })

  it('substitutes when the value is an empty string', () => {
    expect(substituteVariables('Hello {{name}}!', { name: '' })).toBe('Hello !')
  })
})
