import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { listOpenAICompatibleEndpoints } from '../../store'
import { LLMError } from '../types'
import type {
  LLMCallOpts,
  ModelRef,
  TextChunk,
  AgentEvent,
  Usage,
  LLMErrorKind,
} from '../types'

export class OpenAICompatibleAdapter {
  async generateText(
    ref: ModelRef,
    opts: LLMCallOpts,
  ): Promise<{ text: string; usage: Usage }> {
    const endpoint = this.resolveEndpoint(ref)
    const config: Record<string, unknown> = {
      name: endpoint.id,
      baseURL: endpoint.baseUrl,
    }
    if (endpoint.apiKey) config.apiKey = endpoint.apiKey
    // SDK version skew: @ai-sdk/openai-compatible@1.0.x ships LanguageModelV2 while ai@4.x expects
    // LanguageModelV1. Double-cast suppresses the structural check; at runtime the SDKs interop
    // correctly (verified by passing tests).
    const provider = createOpenAICompatible(config as unknown as Parameters<typeof createOpenAICompatible>[0])
    try {
      const result = await generateText({
        model: provider(ref.model),
        system: opts.systemPrompt,
        messages: opts.messages,
        maxTokens: opts.maxTokens,
        abortSignal: opts.signal,
        // SDK version skew: @ai-sdk/openai-compatible@1.0.x ships LanguageModelV2 while ai@4.x expects
        // LanguageModelV1. Double-cast suppresses the structural check; at runtime the SDKs interop
        // correctly (verified by passing tests).
      } as unknown as Parameters<typeof generateText>[0])
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
    throw new LLMError('unknown', 'OpenAICompatibleAdapter.streamText not implemented (Phase 5)')
  }

  async *runAgentLoop(_ref: ModelRef, _opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    throw new LLMError('unknown', 'OpenAICompatibleAdapter.runAgentLoop not implemented (Phase 5)')
  }

  private resolveEndpoint(ref: ModelRef): { id: string; baseUrl: string; apiKey?: string } {
    const endpoints = listOpenAICompatibleEndpoints()
    if (endpoints.length === 0) {
      throw new LLMError(
        'auth_missing',
        'No openai-compatible endpoints configured. Add one in Settings → Providers (e.g. http://localhost:11434/v1 for Ollama).',
      )
    }
    if (!ref.endpoint) {
      // No explicit endpoint id → use the first configured endpoint.
      return endpoints[0]
    }
    const match = endpoints.find(e => e.id === ref.endpoint)
    if (!match) {
      throw new LLMError(
        'model_unavailable',
        `Endpoint "${ref.endpoint}" is not configured. Available: ${endpoints.map(e => e.id).join(', ')}.`,
      )
    }
    return match
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
  return new LLMError(kind, e?.message ?? 'openai-compatible adapter failed', err)
}
