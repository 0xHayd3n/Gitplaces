import { generateText, streamText } from 'ai'
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
  McpTool,
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

  async *streamText(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk> {
    for await (const ev of this.runAgentLoop(ref, opts)) {
      if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta }
      if (ev.type === 'error') throw ev.error
    }
  }

  async *runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent> {
    const apiKey = this.assertApiKey()
    const provider = createGoogleGenerativeAI({ apiKey })

    let stream: { fullStream: AsyncIterable<any> }
    try {
      stream = streamText({
        model: provider(ref.model),
        system: opts.systemPrompt,
        messages: opts.messages,
        tools: toolsForSDK(opts.tools),
        maxTokens: opts.maxTokens,
        abortSignal: opts.signal,
        maxSteps: opts.tools && opts.tools.length > 0 ? 5 : 1,
      } as Parameters<typeof streamText>[0])
    } catch (err) {
      yield { type: 'error', error: normalizeError(err) }
      return
    }

    try {
      for await (const chunk of stream.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            yield { type: 'text-delta', delta: chunk.textDelta }
            break
          case 'tool-call':
            yield { type: 'tool-call', id: chunk.toolCallId, name: chunk.toolName, args: chunk.args as Record<string, unknown> }
            break
          case 'tool-result':
            yield { type: 'tool-result', id: chunk.toolCallId, result: chunk.result, isError: false }
            break
          case 'finish':
            yield {
              type: 'done',
              usage: {
                promptTokens:     chunk.usage?.promptTokens     ?? 0,
                completionTokens: chunk.usage?.completionTokens ?? 0,
                totalTokens:      chunk.usage?.totalTokens      ?? 0,
              },
            }
            break
          case 'error':
            yield { type: 'error', error: normalizeError(chunk.error) }
            break
        }
      }
    } catch (err) {
      yield { type: 'error', error: normalizeError(err) }
    }
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

function toolsForSDK(tools: McpTool[] | undefined): Record<string, unknown> | undefined {
  if (!tools || tools.length === 0) return undefined
  const out: Record<string, { description: string; parameters: unknown; execute: (args: Record<string, unknown>) => Promise<unknown> }> = {}
  for (const t of tools) {
    out[t.name] = {
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    }
  }
  return out
}
