// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockStreamText, mockCreate, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockStreamText:   vi.fn(),
    mockCreate: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText:   mockStreamText,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mockCreate,
}))

vi.mock('../../store', () => ({
  listOpenAICompatibleEndpoints: vi.fn(() => [
    { id: 'ollama-local', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-key' },
  ]),
}))

import { OpenAICompatibleAdapter } from './openai-compatible'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockStreamText.mockReset()
  mockCreate.mockClear()
  mockModelBuilder.mockClear()
})

describe('OpenAICompatibleAdapter.generateText', () => {
  it('resolves the explicit endpoint id and passes its baseURL to createOpenAICompatible', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from ollama',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1:70b' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:11434/v1',
      name: 'ollama-local',
    }))
    expect(mockModelBuilder).toHaveBeenCalledWith('llama3.1:70b')
  })

  it('passes the endpoint apiKey when present', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'lmstudio', model: 'qwen-7b' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:1234/v1',
      apiKey: 'lm-key',
    }))
  })

  it('falls back to the first configured endpoint when no endpoint id is given', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new OpenAICompatibleAdapter()
    await adapter.generateText(
      { provider: 'openai-compatible', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    // First endpoint in the mocked list is ollama-local.
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:11434/v1',
    }))
  })

  it('throws auth_missing when no endpoints are configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.listOpenAICompatibleEndpoints).mockReturnValueOnce([])
    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', model: 'whatever' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('throws model_unavailable when the requested endpoint id does not exist', async () => {
    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'nonexistent', model: 'whatever' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'model_unavailable' })
  })

  it('normalizes ECONNREFUSED into network (Ollama not running case)', async () => {
    const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:11434')
    netErr.code = 'ECONNREFUSED'
    mockGenerateText.mockRejectedValue(netErr)

    const adapter = new OpenAICompatibleAdapter()
    await expect(adapter.generateText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
  })
})

describe('OpenAICompatibleAdapter.runAgentLoop', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta + done from a simple stream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'llama-' },
      { type: 'text-delta', textDelta: '3.1 says hi' },
      { type: 'finish', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ]))

    const adapter = new OpenAICompatibleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'llama-' },
      { type: 'text-delta', delta: '3.1 says hi' },
      { type: 'done', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ])
  })

  it('passes tools through and yields tool-call + tool-result events', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_skills', args: { q: 'http' } },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_skills', result: { hits: 2 } },
      { type: 'text-delta', textDelta: 'Found 2 skills.' },
      { type: 'finish', usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } },
    ]))

    const adapter = new OpenAICompatibleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      {
        messages: [{ role: 'user', content: 'find http skills' }],
        tools: [{
          name: 'search_skills',
          description: 'Search skills',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute: async () => ({ hits: 2 }),
        }],
      },
    )) {
      events.push(ev)
    }

    expect(events.map(e => e.type)).toEqual(['tool-call', 'tool-result', 'text-delta', 'done'])
  })

  it('yields error event when streamText throws', async () => {
    mockStreamText.mockImplementation(() => { throw new Error('openai-compatible rate limit') })

    const adapter = new OpenAICompatibleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('rate limit')
  })

  it('passes the endpoint apiKey to createOpenAICompatible during runAgentLoop', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
    ]))

    const adapter = new OpenAICompatibleAdapter()
    for await (const _ of adapter.runAgentLoop(
      { provider: 'openai-compatible', endpoint: 'lmstudio', model: 'qwen-7b' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {}

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://localhost:1234/v1',
      apiKey:  'lm-key',
    }))
  })
})

describe('OpenAICompatibleAdapter.streamText', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta only', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'a' },
      { type: 'tool-call', toolCallId: 'x', toolName: 'y', args: {} },
      { type: 'text-delta', textDelta: 'b' },
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ]))

    const adapter = new OpenAICompatibleAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      out.push(c)
    }
    expect(out).toEqual([
      { type: 'text-delta', delta: 'a' },
      { type: 'text-delta', delta: 'b' },
    ])
  })
})
