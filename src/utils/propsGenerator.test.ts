import { describe, it, expect } from 'vitest'
import { generateProps } from './propsGenerator'
import type { ParsedProp } from './componentParser'

function prop(name: string, type: string, required = true): ParsedProp {
  return { name, type, required }
}

describe('generateProps', () => {
  it('generates "Text" for string props', () => {
    expect(generateProps([prop('label', 'string')])).toEqual({ label: 'Text' })
  })

  it('generates 0 for number props', () => {
    expect(generateProps([prop('count', 'number')])).toEqual({ count: 0 })
  })

  it('generates false for boolean props', () => {
    expect(generateProps([prop('disabled', 'boolean')])).toEqual({ disabled: false })
  })

  it('generates [] for string array', () => {
    expect(generateProps([prop('items', 'string[]')])).toEqual({ items: [] })
  })

  it('generates [] for number array', () => {
    expect(generateProps([prop('ids', 'number[]')])).toEqual({ ids: [] })
  })

  it('picks the first value from a string union', () => {
    expect(generateProps([prop('size', "'sm' | 'md' | 'lg'")])).toEqual({ size: 'sm' })
  })

  it('omits React.ReactNode props', () => {
    expect(generateProps([prop('children', 'React.ReactNode')])).toEqual({})
  })

  it('omits ReactNode props', () => {
    expect(generateProps([prop('children', 'ReactNode')])).toEqual({})
  })

  it('omits VNode props', () => {
    expect(generateProps([prop('slot', 'VNode')])).toEqual({})
  })

  it('omits function props starting with (', () => {
    expect(generateProps([prop('onClick', '() => void')])).toEqual({})
  })

  it('omits function props with arrow type', () => {
    expect(generateProps([prop('onChange', '(val: string) => void')])).toEqual({})
  })

  it('omits complex/object props', () => {
    expect(generateProps([prop('style', 'CSSProperties')])).toEqual({})
  })

  it('omits Snippet props', () => {
    expect(generateProps([prop('content', 'Snippet')])).toEqual({})
  })

  it('omits ReactElement props', () => {
    expect(generateProps([prop('icon', 'ReactElement')])).toEqual({})
  })

  it('omits JSX.Element props', () => {
    expect(generateProps([prop('slot', 'JSX.Element')])).toEqual({})
  })

  it('handles multiple props together', () => {
    const result = generateProps([
      prop('label', 'string'),
      prop('disabled', 'boolean'),
      prop('onClick', '() => void'),
      prop('children', 'ReactNode'),
    ])
    expect(result).toEqual({ label: 'Text', disabled: false })
  })

  it('returns empty object for empty props array', () => {
    expect(generateProps([])).toEqual({})
  })

  it('uses extractedDefault when present, overriding type inference', () => {
    const result = generateProps([
      { name: 'size', type: 'number', required: false, extractedDefault: 15 },
      { name: 'color', type: 'string', required: false, extractedDefault: '#36d7b7' },
      { name: 'loading', type: 'boolean', required: false, extractedDefault: true },
    ])
    expect(result).toEqual({ size: 15, color: '#36d7b7', loading: true })
  })

  it('falls back to type inference when extractedDefault is missing', () => {
    const result = generateProps([
      { name: 'size', type: 'number', required: false, extractedDefault: 15 },
      { name: 'label', type: 'string', required: false },
    ])
    expect(result).toEqual({ size: 15, label: 'Text' })
  })
})
