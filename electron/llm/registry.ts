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
 *   - "inherit"                        → { provider: 'anthropic', model: 'inherit' }  (see SENTINEL below)
 *   - "sonnet" | "opus" | "haiku"      → mapped to anthropic/claude-<id>
 *   - "<provider>/<model>"             → explicit
 *   - "openai-compatible:<endpoint>/<model>" → endpoint id + model
 *
 * The model segment is preserved verbatim and may contain `:` (e.g. "llama3.1:70b").
 * Split rule: first '/' separates provider+endpoint from model; first ':' on the left
 * side separates provider from endpoint id (only valid for openai-compatible). The
 * endpoint id itself must NOT contain ':'.
 *
 * SENTINEL — `model === 'inherit'`: callers that dispatch on `ref.provider` MUST check
 * for this sentinel BEFORE choosing an adapter, since the returned `provider: 'anthropic'`
 * is a placeholder, not an actual provider choice. The adapter resolves the real model
 * at call time from per-feature defaults. (See AnthropicAdapter.generateText for the
 * current resolution behavior.)
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
    if (endpoint.includes(':')) {
      throw new Error(`Invalid model ref "${input}": endpoint id may not contain a colon (use a slug like 'ollama-local', not a URL)`)
    }
  }

  if (!KNOWN_PROVIDERS.includes(provider as ProviderId)) {
    throw new Error(`Invalid model ref "${input}": unknown provider "${provider}"`)
  }

  return endpoint
    ? { provider: provider as ProviderId, endpoint, model }
    : { provider: provider as ProviderId, model }
}

/**
 * Format a ModelRef back to the canonical `<provider>/<model>` string. Note: legacy
 * aliases (sonnet/opus/haiku) expand on parse — `formatModelRef(parseModelRef('sonnet'))`
 * returns `'anthropic/claude-sonnet-4-6'`, not `'sonnet'`. The round-trip is lossy for
 * legacy input by design.
 */
export function formatModelRef(ref: ModelRef): string {
  if (ref.endpoint) {
    return `${ref.provider}:${ref.endpoint}/${ref.model}`
  }
  return `${ref.provider}/${ref.model}`
}
