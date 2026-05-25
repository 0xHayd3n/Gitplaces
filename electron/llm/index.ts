import { AnthropicAdapter } from './adapters/anthropic'
import { LLMError } from './types'
import type {
  AgentEvent,
  LLMCallOpts,
  LLMService,
  ModelRef,
  TextChunk,
  Usage,
} from './types'

export * from './types'
export { parseModelRef, formatModelRef } from './registry'

type AdapterLike = {
  generateText(ref: ModelRef, opts: LLMCallOpts): Promise<{ text: string; usage: Usage }>
  streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk>
  runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}

export function createLLMService(): LLMService {
  // Adapters are constructed lazily — keeps test mocks predictable and avoids
  // touching settings storage when an adapter is never used.
  let anthropicAdapter: AnthropicAdapter | undefined

  function resolveAdapter(ref: ModelRef): AdapterLike {
    switch (ref.provider) {
      case 'anthropic':
        return (anthropicAdapter ??= new AnthropicAdapter())
      // Other providers land in Phase 4. Until then, calling them is an error.
      case 'openai':
      case 'google':
      case 'opencode':
      case 'openai-compatible':
        throw new LLMError(
          'unknown',
          `Provider "${ref.provider}" has no adapter yet — scheduled for Phase 4.`,
        )
      default: {
        // Exhaustiveness — should be unreachable while ProviderId stays narrow.
        const exhaustive: never = ref.provider
        throw new LLMError('unknown', `Unknown provider: ${String(exhaustive)}`)
      }
    }
  }

  return {
    async generateText(ref, opts) {
      return resolveAdapter(ref).generateText(ref, opts)
    },
    streamText(ref, opts) {
      // resolveAdapter may throw synchronously; wrap in an async generator so the
      // caller always gets a rejected iterable rather than a thrown exception.
      const adapter = resolveAdapter(ref)
      return adapter.streamText(ref, opts)
    },
    runAgentLoop(ref, opts) {
      const adapter = resolveAdapter(ref)
      return adapter.runAgentLoop(ref, opts)
    },
  }
}
