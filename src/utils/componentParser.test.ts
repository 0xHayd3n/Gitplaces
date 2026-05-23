import { describe, it, expect } from 'vitest'
import { parseComponent } from './componentParser'

describe('parseComponent — React', () => {
  const source = `
    interface ButtonProps {
      label: string
      disabled?: boolean
      count: number
      onClick?: () => void
      children?: React.ReactNode
    }
    export default function Button({ label }: ButtonProps) {
      return <button>{label}</button>
    }
  `

  it('extracts the component name from the file path', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    expect(result.name).toBe('Button')
  })

  it('converts kebab-case filenames to PascalCase (Radix-style)', () => {
    const result = parseComponent('packages/react/dialog/src/dialog.tsx', '', 'react')
    expect(result.name).toBe('Dialog')
  })

  it('converts multi-word kebab-case filenames to PascalCase', () => {
    const result = parseComponent('packages/react/alert-dialog/src/alert-dialog.tsx', '', 'react')
    expect(result.name).toBe('AlertDialog')
  })

  it('leaves PascalCase filenames unchanged', () => {
    const result = parseComponent('src/components/MyComponent.tsx', '', 'react')
    expect(result.name).toBe('MyComponent')
  })

  it('uses the exported identifier from `export default function Name`', () => {
    const result = parseComponent(
      'examples/code.tsx',
      'export default function InstallCode() { return null }',
      'react',
    )
    expect(result.name).toBe('InstallCode')
  })

  it('uses the exported identifier from `export default Identifier`', () => {
    const result = parseComponent(
      'examples/picker.tsx',
      'class CPicker extends Component {}\nexport default CPicker',
      'react',
    )
    expect(result.name).toBe('CPicker')
  })

  it('uses single named PascalCase export when present', () => {
    const result = parseComponent(
      'examples/loader-item.tsx',
      'export const LoaderItem = () => null',
      'react',
    )
    expect(result.name).toBe('LoaderItem')
  })

  it('falls back to filename PascalCase when no usable export found', () => {
    const result = parseComponent(
      'src/utils/helpers.ts',
      'export const foo = 1\nexport const bar = 2',
      'react',
    )
    expect(result.name).toBe('Helpers')
  })

  it('marks react as renderable', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    expect(result.renderable).toBe(true)
  })

  it('marks a file with only createContext exports as non-renderable', () => {
    // Pattern from material-tailwind's `*Context.tsx` files. Rendering the
    // raw Context object as a component triggers React 18's ContextConsumer
    // path, which crashes with "r is not a function" when no render-prop
    // child is provided.
    const ctxOnly = [
      'import React from "react"',
      'export const AccordionContext = React.createContext(null)',
      'export function useAccordion() { return null }',
    ].join('\n')
    const result = parseComponent('src/Accordion/AccordionContext.tsx', ctxOnly, 'react')
    expect(result.renderable).toBe(false)
  })

  it('prefers a sibling Provider component over a Context object', () => {
    // material-tailwind exports both `AccordionContext` (createContext result)
    // and `AccordionContextProvider` (the actual component). The parser should
    // pick the Provider so the gallery renders something benign instead of
    // crashing on the raw Context.
    const ctxAndProvider = [
      'import React from "react"',
      'export const AccordionContext = React.createContext(null)',
      'export function useAccordion() { return null }',
      'export const AccordionContextProvider = ({ value, children }) => null',
    ].join('\n')
    const result = parseComponent(
      'src/Accordion/AccordionContext.tsx', ctxAndProvider, 'react',
    )
    expect(result.name).toBe('AccordionContextProvider')
    expect(result.renderable).toBe(true)
  })

  it('detects createContext without the React. namespace prefix', () => {
    const ctxOnly = [
      'import { createContext } from "react"',
      'export const ThemeContext = createContext(null)',
    ].join('\n')
    const result = parseComponent('src/ThemeContext.tsx', ctxOnly, 'react')
    expect(result.renderable).toBe(false)
  })

  it('detects createContext with a TypeScript type annotation', () => {
    const ctxOnly = [
      'import React from "react"',
      'export const MenuContext: React.Context<MenuValue | null> = React.createContext<MenuValue | null>(null)',
    ].join('\n')
    const result = parseComponent('src/MenuContext.tsx', ctxOnly, 'react')
    expect(result.renderable).toBe(false)
  })

  it('extracts required string prop', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    const label = result.props.find(p => p.name === 'label')
    expect(label).toBeDefined()
    expect(label?.type).toBe('string')
    expect(label?.required).toBe(true)
  })

  it('extracts optional boolean prop', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    const disabled = result.props.find(p => p.name === 'disabled')
    expect(disabled?.required).toBe(false)
  })

  it('extracts number prop', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    const count = result.props.find(p => p.name === 'count')
    expect(count?.type).toBe('number')
  })

  it('includes function and node props in list (generation omits them)', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    expect(result.props.some(p => p.name === 'onClick')).toBe(true)
    expect(result.props.some(p => p.name === 'children')).toBe(true)
  })

  it('handles type alias Props form', () => {
    const src = `type CardProps = { title: string; body?: string }`
    const result = parseComponent('Card.tsx', src, 'react')
    expect(result.props.some(p => p.name === 'title')).toBe(true)
  })

  it('marks solid as renderable', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'solid')
    expect(result.renderable).toBe(true)
  })
})

describe('parseComponent — Vue', () => {
  const source = `
    <template><div>{{ label }}</div></template>
    <script setup>
    defineProps<{ label: string; size?: 'sm' | 'lg' }>()
    </script>
  `

  it('extracts Vue props from defineProps<{...}>', () => {
    const result = parseComponent('src/components/Badge.vue', source, 'vue')
    expect(result.props.some(p => p.name === 'label')).toBe(true)
  })

  it('marks vue as renderable', () => {
    const result = parseComponent('src/components/Badge.vue', source, 'vue')
    expect(result.renderable).toBe(true)
  })

  it('extracts Vue props from options API props object', () => {
    const opts = `export default { props: {\n  title: { type: String },\n  size: { type: Number }\n} }`
    const result = parseComponent('src/components/Card.vue', opts, 'vue')
    expect(result.props.some(p => p.name === 'title')).toBe(true)
  })
})

describe('parseComponent — Svelte', () => {
  const source = `
    <script>
    export let label = 'default';
    export let count: number;
    export let active: boolean = false;
    </script>
    <div>{label}</div>
  `

  it('extracts Svelte exported props', () => {
    const result = parseComponent('src/Badge.svelte', source, 'svelte')
    expect(result.props.some(p => p.name === 'label')).toBe(true)
    expect(result.props.some(p => p.name === 'count')).toBe(true)
  })

  it('marks svelte as renderable', () => {
    const result = parseComponent('src/Badge.svelte', source, 'svelte')
    expect(result.renderable).toBe(true)
  })

  it('captures default values', () => {
    const result = parseComponent('src/Badge.svelte', source, 'svelte')
    const active = result.props.find(p => p.name === 'active')
    expect(active?.defaultValue).toBe('false')
  })
})

describe('parseComponent — Angular / unknown', () => {
  it('marks angular as renderable', () => {
    const result = parseComponent('button.component.ts', '', 'angular')
    expect(result.renderable).toBe(true)
  })

  it('marks unknown as renderable', () => {
    const result = parseComponent('Widget.tsx', '', 'unknown')
    expect(result.renderable).toBe(true)
  })

  it('returns empty props for angular', () => {
    const result = parseComponent('button.component.ts', '', 'angular')
    expect(result.props).toEqual([])
  })
})

describe('parseComponent — string-literal unions', () => {
  it('extracts a string-union prop into stringUnion', () => {
    const source = `
      interface ButtonProps {
        variant: 'primary' | 'secondary' | 'ghost'
      }
    `
    const result = parseComponent('Button.tsx', source, 'react')
    const variant = result.props.find(p => p.name === 'variant')
    expect(variant?.stringUnion).toEqual(['primary', 'secondary', 'ghost'])
  })

  it('handles double-quoted union members', () => {
    const source = `
      interface Props { size: "sm" | "md" | "lg" }
    `
    const result = parseComponent('X.tsx', source, 'react')
    const size = result.props.find(p => p.name === 'size')
    expect(size?.stringUnion).toEqual(['sm', 'md', 'lg'])
  })

  it('does not set stringUnion for non-union types', () => {
    const source = `
      interface Props { label: string }
    `
    const result = parseComponent('X.tsx', source, 'react')
    expect(result.props[0].stringUnion).toBeUndefined()
  })

  it('does not set stringUnion for unions with non-string members', () => {
    const source = `
      interface Props { x: 'a' | number }
    `
    const result = parseComponent('X.tsx', source, 'react')
    expect(result.props[0].stringUnion).toBeUndefined()
  })
})

describe('parseComponent — destructure defaults', () => {
  it('extracts numeric, string, and boolean defaults from a function declaration', () => {
    const source = `
      import { LoaderProps } from './helpers/props'
      function BarLoader({
        loading = true,
        color = '#000000',
        size = 15,
        margin = 2,
        cssOverride,
      }: LoaderProps) {
        return null
      }
    `
    const result = parseComponent('BarLoader.tsx', source, 'react')
    const byName = Object.fromEntries(result.props.map(p => [p.name, p.extractedDefault]))
    expect(byName.loading).toBe(true)
    expect(byName.color).toBe('#000000')
    expect(byName.size).toBe(15)
    expect(byName.margin).toBe(2)
    // cssOverride has no default → no extractedDefault, but the prop won't
    // appear at all because the type is imported from another file.
    expect(result.props.find(p => p.name === 'cssOverride')).toBeUndefined()
  })

  it('extracts defaults from arrow function with type annotation', () => {
    const source = `
      const ClipLoader: React.FC<Props> = ({
        loading = true,
        color = '#36d7b7',
      }) => null
    `
    const result = parseComponent('ClipLoader.tsx', source, 'react')
    expect(result.props.find(p => p.name === 'color')?.extractedDefault).toBe('#36d7b7')
    expect(result.props.find(p => p.name === 'loading')?.extractedDefault).toBe(true)
  })

  it('extracts empty object and array defaults', () => {
    const source = `
      function Foo({ cssOverride = {}, items = [] }: Props) { return null }
    `
    const result = parseComponent('Foo.tsx', source, 'react')
    expect(result.props.find(p => p.name === 'cssOverride')?.extractedDefault).toEqual({})
    expect(result.props.find(p => p.name === 'items')?.extractedDefault).toEqual([])
  })

  it('drops complex defaults (function calls, references) silently', () => {
    const source = `
      function Foo({ size = computeSize(), color = DEFAULT_COLOR }: Props) { return null }
    `
    const result = parseComponent('Foo.tsx', source, 'react')
    expect(result.props.find(p => p.name === 'size')).toBeUndefined()
    expect(result.props.find(p => p.name === 'color')).toBeUndefined()
  })

  it('skips rest patterns', () => {
    const source = `
      function Foo({ a = 1, ...rest }: Props) { return null }
    `
    const result = parseComponent('Foo.tsx', source, 'react')
    expect(result.props.find(p => p.name === 'rest')).toBeUndefined()
    expect(result.props.find(p => p.name === 'a')?.extractedDefault).toBe(1)
  })

  it('merges defaults onto props from interface (not duplicate)', () => {
    const source = `
      interface ButtonProps {
        size: number
        label: string
      }
      function Button({ size = 15, label = 'Click' }: ButtonProps) { return null }
    `
    const result = parseComponent('Button.tsx', source, 'react')
    expect(result.props).toHaveLength(2)
    expect(result.props.find(p => p.name === 'size')?.extractedDefault).toBe(15)
    expect(result.props.find(p => p.name === 'label')?.extractedDefault).toBe('Click')
  })
})
