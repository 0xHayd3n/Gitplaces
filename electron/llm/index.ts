import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAIAdapter } from './adapters/openai'
import { GoogleAdapter } from './adapters/google'
import { OpenAICompatibleAdapter } from './adapters/openai-compatible'
import { runAgentLoop as runnerRunAgentLoop } from './runner'
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
  let anthropicAdapter:        AnthropicAdapter        | undefined
  let openaiAdapter:           OpenAIAdapter           | undefined
  let googleAdapter:           GoogleAdapter           | undefined
  let openaiCompatibleAdapter: OpenAICompatibleAdapter | undefined

  function resolveAdapter(ref: ModelRef): AdapterLike {
    switch (ref.provider) {
      case 'anthropic':
        return (anthropicAdapter ??= new AnthropicAdapter())
      case 'openai':
        return (openaiAdapter ??= new OpenAIAdapter())
      case 'google':
        return (googleAdapter ??= new GoogleAdapter())
      case 'openai-compatible':
        return (openaiCompatibleAdapter ??= new OpenAICompatibleAdapter())
      case 'opencode':
        // OpenCode runs through the CLI subprocess path (see runChat in
        // electron/services/dispatchChat.ts). The in-app runner doesn't support
        // it — reaching this branch means a caller bypassed runChat with an
        // opencode ModelRef, which is a bug.
        throw new LLMError('unknown', 'OpenCode runs via the CLI subprocess path; the in-app runner does not support it. Use runChat() instead of createLLMService() for opencode models.')
      default: {
        const exhaustive: never = ref.provider
        throw new LLMError('unknown', `Unknown provider: ${String(exhaustive)}`)
      }
    }
  }

  return {
    async generateText(ref, opts) {
      return resolveAdapter(ref).generateText(ref, opts)
    },
    // streamText and runAgentLoop are async generators so a synchronous throw
    // from resolveAdapter() surfaces as a rejected iterable on the first iteration
    // (consistent with how callers `for await` over the result).
    async *streamText(ref, opts) {
      const adapter = resolveAdapter(ref)
      yield* adapter.streamText(ref, opts)
    },
    async *runAgentLoop(ref, opts) {
      const adapter = resolveAdapter(ref)
      yield* runnerRunAgentLoop(adapter, ref, opts)
    },
  }
}
