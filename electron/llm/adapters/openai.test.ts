// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockStreamText, mockCreateOpenAI, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockStreamText:   vi.fn(),
    mockCreateOpenAI: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText:   mockStreamText,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}))

vi.mock('../../store', () => ({
  getOpenAIProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'sk-openai-test' })),
}))

import { OpenAIAdapter } from './openai'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockStreamText.mockReset()
  mockCreateOpenAI.mockClear()
  mockModelBuilder.mockClear()
})

describe('OpenAIAdapter.generateText', () => {
  it('wires the stored API key into createOpenAI and calls generateText with the model id', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from gpt',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new OpenAIAdapter()
    const result = await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      },
    )

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-test' })
    expect(mockModelBuilder).toHaveBeenCalledWith('gpt-4o')
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    }))
    expect(result).toEqual({
      text: 'hello from gpt',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('throws LLMError kind=auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getOpenAIProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new OpenAIAdapter()
    await expect(adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 401 into LLMError kind=auth_invalid', async () => {
    const sdkErr: any = new Error('Unauthorized')
    sdkErr.statusCode = 401
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new OpenAIAdapter()
    await expect(adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_invalid' })
  })

  it('forwards AbortSignal to generateText as abortSignal', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const controller = new AbortController()
    const adapter = new OpenAIAdapter()
    await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }))
  })

  it('passes the optional organization header to createOpenAI when configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getOpenAIProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: 'sk-x', organization: 'org-foo' })
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

    const adapter = new OpenAIAdapter()
    await adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-x', organization: 'org-foo' })
  })

  it('normalizes ECONNREFUSED into LLMError kind=network', async () => {
    const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:443')
    netErr.code = 'ECONNREFUSED'
    mockGenerateText.mockRejectedValue(netErr)

    const adapter = new OpenAIAdapter()
    await expect(adapter.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
  })
})

describe('OpenAIAdapter.runAgentLoop', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta + done from a simple stream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'gpt-' },
      { type: 'text-delta', textDelta: '4o says hi' },
      { type: 'finish', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ]))

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'gpt-' },
      { type: 'text-delta', delta: '4o says hi' },
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

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
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
    mockStreamText.mockImplementation(() => { throw new Error('OpenAI rate limit') })

    const adapter = new OpenAIAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('rate limit')
  })
})

describe('OpenAIAdapter.streamText', () => {
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

    const adapter = new OpenAIAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'openai', model: 'gpt-4o' },
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
