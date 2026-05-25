import { parseModelRef } from '../llm/registry'
import type { ProviderId } from '../llm/types'

export type ImportedModel = 'sonnet' | 'opus' | 'haiku' | 'inherit'

const FULL_TO_SHORT_MODEL: Record<string, ImportedModel> = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-7': 'opus',
  'claude-haiku-4-5-20251001': 'haiku',
}

/**
 * LEGACY — Phase 1 short-name parser. Kept for back-compat with consumers
 * that only want the 4-value enum (e.g. UI chip rendering before the
 * Phase 4 multi-provider UI lands). For Phase 2+ persistence,
 * use {@link parseAgentModel} which returns structured provider data.
 */
export function parseModelFrontmatter(raw: unknown): ImportedModel {
  if (typeof raw !== 'string') return 'inherit'
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') return raw
  const mapped = FULL_TO_SHORT_MODEL[raw]
  if (mapped) return mapped
  // Non-anthropic provider strings (openai/gpt-4o, etc.) return 'inherit' here
  // — they're handled by parseAgentModel for proper storage.
  // eslint-disable-next-line no-console
  console.warn(`[frontmatterFields] parseModelFrontmatter: unknown model "${raw}", falling back to 'inherit'.`)
  return 'inherit'
}

export type ParsedAgentModel = {
  /** The model string as it should be stored in `agents.model` (raw, lossless). */
  model: string
  /** Denormalized provider id for `agents.model_provider`. */
  provider: ProviderId
  /** Denormalized endpoint id for `agents.model_endpoint_id` (only for openai-compatible). */
  endpoint: string | null
}

/**
 * Parse a frontmatter `model:` field into the three columns the Phase 2
 * agents schema stores. Accepts:
 *   - Legacy short names: 'sonnet' | 'opus' | 'haiku' | 'inherit' (kept verbatim in `model`)
 *   - Full Anthropic IDs: 'claude-sonnet-4-6' (kept verbatim; provider=anthropic)
 *   - New format: '<provider>/<model>' or 'openai-compatible:<endpoint>/<model>'
 *     (kept verbatim in `model`; provider/endpoint denormalized via parseModelRef)
 *
 * Unknown/malformed input falls back to `{ model: 'inherit', provider: 'anthropic', endpoint: null }`
 * with a console.warn, matching the safe-by-default behaviour of the legacy parser.
 */
export function parseAgentModel(raw: unknown): ParsedAgentModel {
  if (typeof raw !== 'string') {
    // eslint-disable-next-line no-console
    console.warn(`[frontmatterFields] parseAgentModel: non-string input ${typeof raw}, falling back to inherit.`)
    return { model: 'inherit', provider: 'anthropic', endpoint: null }
  }

  // Legacy short names + 'inherit' → keep verbatim, provider is implicitly anthropic.
  if (raw === 'sonnet' || raw === 'opus' || raw === 'haiku' || raw === 'inherit') {
    return { model: raw, provider: 'anthropic', endpoint: null }
  }

  // Full Anthropic IDs → keep verbatim, provider is anthropic.
  if (FULL_TO_SHORT_MODEL[raw]) {
    return { model: raw, provider: 'anthropic', endpoint: null }
  }

  // New format — delegate parsing to parseModelRef. The raw string is stored
  // verbatim in `model`; provider/endpoint come from the parsed ref.
  try {
    const ref = parseModelRef(raw)
    return {
      model: raw,
      provider: ref.provider,
      endpoint: ref.endpoint ?? null,
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[frontmatterFields] parseAgentModel: invalid model "${raw}" (${(err as Error).message}), falling back to inherit.`)
    return { model: 'inherit', provider: 'anthropic', endpoint: null }
  }
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
