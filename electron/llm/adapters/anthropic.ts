import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { getProviderConfig } from '../../store'
import { LLMError } from '../types'
import type {
  LLMCallOpts,
  ModelRef,
  TextChunk,
  AgentEvent,
  Usage,
  LLMErrorKind,
} from '../types'

const INHERIT_DEFAULT = 'claude-sonnet-4-6'

export class AnthropicAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    this.assertApiKey()
    const modelId = ref.model === 'inherit' ? INHERIT_DEFAULT : ref.model
    try {
      const result = await generateText({
        model: anthropic(modelId),
        system: opts.systemPrompt,
        messages: opts.messages,
        maxTokens: opts.maxTokens,
        abortSignal: opts.signal,
      } as Parameters<typeof generateText>[0])
      return {
        text: result.text,
        usage: {
          promptTokens:     result.usage?.promptTokens     ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0,
          totalTokens:      result.usage?.totalTokens      ?? 0,
        },
      }
    } catch (err) {
      throw normalizeError(err)
    }
  }

  // Phase 5 will fill these in. Stubs throw so misuse fails loudly during
  // the period when only generateText is wired up.
  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'AnthropicAdapter.streamText not implemented in Phase 1')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'AnthropicAdapter.runAgentLoop not implemented in Phase 1')
  }

  private assertApiKey(): void {
    const cfg = getProviderConfig('anthropic')
    if (!cfg.apiKey) {
      throw new LLMError('auth_missing', 'Anthropic API key is not configured. Set it in Settings → Providers.')
    }
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  return new LLMError(kind, e?.message ?? 'Anthropic adapter failed', err)
}
