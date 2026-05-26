// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockStreamText, mockCreateGoogle, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockStreamText:   vi.fn(),
    mockCreateGoogle: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText:   mockStreamText,
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mockCreateGoogle,
}))

vi.mock('../../store', () => ({
  getProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'g-test-key' })),
}))

import { GoogleAdapter } from './google'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockStreamText.mockReset()
  mockCreateGoogle.mockClear()
  mockModelBuilder.mockClear()
})

describe('GoogleAdapter.generateText', () => {
  it('wires the API key into createGoogleGenerativeAI and calls generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello from gemini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new GoogleAdapter()
    const result = await adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
    )

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: 'g-test-key' })
    expect(mockModelBuilder).toHaveBeenCalledWith('gemini-2.5-pro')
    expect(result.text).toBe('hello from gemini')
  })

  it('throws auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new GoogleAdapter()
    await expect(adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 429 into rate_limit', async () => {
    const sdkErr: any = new Error('Rate limited')
    sdkErr.statusCode = 429
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new GoogleAdapter()
    await expect(adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'rate_limit' })
  })

  it('normalizes ECONNREFUSED into network', async () => {
    const netErr: any = new Error('connect ECONNREFUSED')
    netErr.code = 'ECONNREFUSED'
    mockGenerateText.mockRejectedValue(netErr)

    const adapter = new GoogleAdapter()
    await expect(adapter.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
  })
})

describe('GoogleAdapter.runAgentLoop', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return { fullStream: (async function* () { for (const c of chunks) yield c })() }
  }

  it('yields text-delta + done from a simple stream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'gemini-' },
      { type: 'text-delta', textDelta: '2.5-pro says hi' },
      { type: 'finish', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    ]))

    const adapter = new GoogleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'gemini-' },
      { type: 'text-delta', delta: '2.5-pro says hi' },
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

    const adapter = new GoogleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'google', model: 'gemini-2.5-pro' },
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
    mockStreamText.mockImplementation(() => { throw new Error('Google rate limit') })

    const adapter = new GoogleAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('rate limit')
  })
})

describe('GoogleAdapter.streamText', () => {
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

    const adapter = new GoogleAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'google', model: 'gemini-2.5-pro' },
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
