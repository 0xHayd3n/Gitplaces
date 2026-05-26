import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

export class GoogleAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    const apiKey = this.assertApiKey()
    const provider = createGoogleGenerativeAI({ apiKey })
    try {
      const result = await generateText({
        model: provider(ref.model),
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

  async *streamText(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<TextChunk> {
    throw new LLMError('unknown', 'GoogleAdapter.streamText not implemented (Phase 5)')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'GoogleAdapter.runAgentLoop not implemented (Phase 5)')
  }

  private assertApiKey(): string {
    const cfg = getProviderConfig('google')
    if (!cfg.apiKey) {
      throw new LLMError('auth_missing', 'Google API key is not configured. Set it in Settings → Providers.')
    }
    return cfg.apiKey
  }
}

function normalizeError(err: unknown): LLMError {
  if (err instanceof LLMError) return err
  const e = err as { statusCode?: number; message?: string; name?: string; code?: string }
  let kind: LLMErrorKind = 'unknown'
  if (e?.name === 'AbortError') kind = 'aborted'
  else if (e?.statusCode === 401) kind = 'auth_invalid'
  else if (e?.statusCode === 429) kind = 'rate_limit'
  else if (e?.statusCode === 404) kind = 'model_unavailable'
  else if (e?.statusCode === 413) kind = 'context_overflow'
  else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND') kind = 'network'
  return new LLMError(kind, e?.message ?? 'Google adapter failed', err)
}
