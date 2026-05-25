export type ImportedModel = 'sonnet' | 'opus' | 'haiku' | 'inherit'

const FULL_TO_SHORT_MODEL: Record<string, ImportedModel> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-7': 'opus',
  'claude-haiku-4-5-20251001': 'haiku',
}

export function parseModelFrontmatter(raw: unknown): ImportedModel {
  if (typeof raw !== 'string') return 'inherit'
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') return raw
  const mapped = FULL_TO_SHORT_MODEL[raw]
  if (mapped) return mapped
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] Unknown model "${raw}", falling back to 'inherit'.`)
  return 'inherit'
}

export function parseToolsFrontmatter(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return []
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
  }
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] Unexpected tools type ${typeof raw}, treating as null.`)
  return null
}

export function parseArgumentHint(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  // YAML parses `argument-hint: [project-name]` as the array ['project-name'].
  // CC writes it as bracket-notation in the source; reconstruct so we can round-trip.
  if (Array.isArray(raw)) {
    return `[${raw.map(v => String(v)).join(', ')}]`
  }
  return null
}
