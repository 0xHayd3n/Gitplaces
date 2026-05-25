// Public types for the LLM provider abstraction.
// This module is the single chokepoint that every AI call in the app
// will go through (refactored into in Phase 3). Adapters live in
// ./adapters/*; the dispatch factory is in ./index.ts.

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'opencode'
  | 'openai-compatible'

export type ModelRef = {
  provider: ProviderId
  /** Provider-native model id, preserved verbatim. May contain `:` (e.g. `llama3.1:70b`). */
  model: string
  /** Only meaningful when provider === 'openai-compatible'. References a user-named endpoint id in settings. */
  endpoint?: string
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

export type LLMCallOpts = {
  systemPrompt?: string
  messages: ChatMessage[]
  tools?: McpTool[]
  maxTokens?: number
  signal?: AbortSignal
}

export type Usage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type TextChunk = { type: 'text-delta'; delta: string }

export type AgentEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; name: string; args: Record<string, unknown>; id: string }
  | { type: 'tool-result'; id: string; result: unknown; isError: boolean }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; error: LLMError }

export type LLMErrorKind =
  | 'auth_missing'
  | 'auth_invalid'
  | 'rate_limit'
  | 'network'
  | 'model_unavailable'
  | 'context_overflow'
  | 'tool_failed'
  | 'aborted'
  | 'unknown'

export class LLMError extends Error {
  kind: LLMErrorKind
  cause?: unknown
  constructor(kind: LLMErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
    this.cause = cause
  }
}

export interface LLMService {
  generateText(model: ModelRef, opts: LLMCallOpts): Promise<{ text: string; usage: Usage }>
  streamText(model: ModelRef, opts: LLMCallOpts): AsyncIterable<TextChunk>
  runAgentLoop(model: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}
