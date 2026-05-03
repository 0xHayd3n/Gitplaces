// src/utils/variantGenerator.ts
import type { ParsedComponent } from './componentParser'
import { generateProps } from './propsGenerator'
import type { Variant } from '../types/components'

const VARIANT_PROP_ALLOWLIST = new Set([
  'variant', 'size', 'color', 'intent', 'kind', 'tone', 'appearance', 'state',
])

const MAX_AUTO_VARIANTS = 6

export function generateVariants(component: ParsedComponent): Variant[] {
  const target = component.props.find(
    p => VARIANT_PROP_ALLOWLIST.has(p.name) && p.stringUnion && p.stringUnion.length >= 2,
  )
  if (!target || !target.stringUnion) return []

  const baseProps = generateProps(component.props)
  const values = target.stringUnion.slice(0, MAX_AUTO_VARIANTS)

  return values.map(value => ({
    name: value,
    props: { ...baseProps, [target.name]: value },
    source: 'auto',
  }))
}
