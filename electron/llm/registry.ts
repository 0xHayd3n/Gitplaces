import type { ModelRef, ProviderId } from './types'

const KNOWN_PROVIDERS: readonly ProviderId[] = [
  'anthropic', 'openai', 'google', 'opencode', 'openai-compatible',
] as const

const LEGACY_ANTHROPIC_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  haiku:  'claude-haiku-4-5',
}

/**
 * Parse a `model:` string from agent frontmatter or settings into a structured ModelRef.
 *
 * Accepted forms:
 *   - "inherit"                        → { anthropic, "inherit" }  (sentinel; resolved at call time)
 *   - "sonnet" | "opus" | "haiku"      → mapped to anthropic/claude-<id>
 *   - "<provider>/<model>"             → explicit
 *   - "openai-compatible:<endpoint>/<model>" → endpoint id + model
 *
 * The model segment is preserved verbatim and may contain `:` (e.g. "llama3.1:70b").
 * Split rule: first '/' separates provider+endpoint from model; first ':' on the left
 * side separates provider from endpoint id (only valid for openai-compatible).
 */
export function parseModelRef(input: string): ModelRef {
  const trimmed = input.trim()

  if (trimmed === 'inherit') {
    return { provider: 'anthropic', model: 'inherit' }
  }

  if (trimmed in LEGACY_ANTHROPIC_ALIASES) {
    return { provider: 'anthropic', model: LEGACY_ANTHROPIC_ALIASES[trimmed] }
  }

  const slashIdx = trimmed.indexOf('/')
  if (slashIdx === -1) {
    throw new Error(`Invalid model ref "${input}": expected provider/model form`)
  }

  const left = trimmed.slice(0, slashIdx)
  const model = trimmed.slice(slashIdx + 1)

  if (model.length === 0) {
    throw new Error(`Invalid model ref "${input}": model segment is empty`)
  }

  let provider: string
  let endpoint: string | undefined

  const colonIdx = left.indexOf(':')
  if (colonIdx === -1) {
    provider = left
  } else {
    provider = left.slice(0, colonIdx)
    endpoint = left.slice(colonIdx + 1)
    if (provider !== 'openai-compatible') {
      throw new Error(`Invalid model ref "${input}": endpoint segment is only allowed for openai-compatible provider, got "${provider}"`)
    }
    if (endpoint.length === 0) {
      throw new Error(`Invalid model ref "${input}": endpoint segment is empty`)
    }
  }

  if (!KNOWN_PROVIDERS.includes(provider as ProviderId)) {
    throw new Error(`Invalid model ref "${input}": unknown provider "${provider}"`)
  }

  return endpoint
    ? { provider: provider as ProviderId, endpoint, model }
    : { provider: provider as ProviderId, model }
}

export function formatModelRef(ref: ModelRef): string {
  if (ref.endpoint) {
    return `${ref.provider}:${ref.endpoint}/${ref.model}`
  }
  return `${ref.provider}/${ref.model}`
}
