import { describe, it, expect } from 'vitest'
import { parseStoryFile, resolveStoryComponent } from './storyParser'

describe('parseStoryFile', () => {
  it('extracts default title and component identifier', () => {
    const source = `
      import { Button } from './Button'
      export default { title: 'Forms/Button', component: Button }
      export const Primary = { args: { variant: 'primary' } }
    `
    const result = parseStoryFile('src/components/Button.stories.tsx', source)
    expect(result?.title).toBe('Forms/Button')
    expect(result?.componentIdent).toBe('Button')
    expect(result?.componentImportPath).toBe('./Button')
  })

  it('extracts named-export stories with parsed args', () => {
    const source = `
      import { Button } from './Button'
      export default { component: Button }
      export const Primary = { args: { variant: 'primary', size: 'md' } }
      export const Secondary = { args: { variant: 'secondary' } }
    `
    const result = parseStoryFile('Button.stories.tsx', source)
    expect(result?.stories).toHaveLength(2)
    expect(result?.stories[0]).toEqual({ name: 'Primary', args: { variant: 'primary', size: 'md' } })
    expect(result?.stories[1]).toEqual({ name: 'Secondary', args: { variant: 'secondary' } })
  })

  it('drops stories whose args fail to parse', () => {
    const source = `
      import { X } from './X'
      export default { component: X }
      export const Good = { args: { foo: 'bar' } }
      export const Broken = { args: { onClick: () => alert('hi') } }
    `
    const result = parseStoryFile('X.stories.tsx', source)
    expect(result?.stories.map(s => s.name)).toEqual(['Good'])
  })

  it('returns null when there is no default export', () => {
    expect(parseStoryFile('X.stories.tsx', 'const Foo = 1')).toBeNull()
  })

  it('returns null when default has no component reference', () => {
    expect(parseStoryFile('X.stories.tsx', 'export default { title: "X" }')).toBeNull()
  })
})

describe('resolveStoryComponent', () => {
  it('resolves "./Button" to Button.tsx in same dir', () => {
    const result = resolveStoryComponent(
      'src/components/Button.stories.tsx',
      './Button',
      ['src/components/Button.tsx', 'src/components/Card.tsx'],
    )
    expect(result).toBe('src/components/Button.tsx')
  })

  it('resolves "./button" to button/index.tsx', () => {
    const result = resolveStoryComponent(
      'src/components/button.stories.tsx',
      './button',
      ['src/components/button/index.tsx'],
    )
    expect(result).toBe('src/components/button/index.tsx')
  })

  it('returns null for path-aliased imports', () => {
    const result = resolveStoryComponent('a/b.stories.tsx', '@/lib/Foo', [])
    expect(result).toBeNull()
  })

  it('returns null when target file is not in scan set', () => {
    const result = resolveStoryComponent('a/b.stories.tsx', './Missing', ['a/Other.tsx'])
    expect(result).toBeNull()
  })
})
