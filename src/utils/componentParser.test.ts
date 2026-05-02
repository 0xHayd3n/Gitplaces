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

  it('marks react as renderable', () => {
    const result = parseComponent('src/components/Button.tsx', source, 'react')
    expect(result.renderable).toBe(true)
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
