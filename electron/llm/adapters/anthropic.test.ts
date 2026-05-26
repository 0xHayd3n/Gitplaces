// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockStreamText, mockCreateAnthropic, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockStreamText: vi.fn(),
    mockCreateAnthropic: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic,
}))

// Mock the store module so the adapter can read the API key without
// constructing a real electron-store.
vi.mock('../../store', () => ({
  getProviderConfig: vi.fn(() => ({ enabled: true, apiKey: 'sk-test-key' })),
}))

import { AnthropicAdapter } from './anthropic'
import { LLMError } from '../types'

beforeEach(() => {
  mockGenerateText.mockReset()
  mockStreamText.mockReset()
  mockCreateAnthropic.mockClear()
  mockModelBuilder.mockClear()
})

describe('AnthropicAdapter.generateText', () => {
  it('constructs the Anthropic model with the ref.model id and calls ai.generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'hello world',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const adapter = new AnthropicAdapter()
    const result = await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        systemPrompt: 'You are helpful',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      },
    )

    expect(mockModelBuilder).toHaveBeenCalledWith('claude-sonnet-4-6')
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    }))
    expect(result).toEqual({
      text: 'hello world',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('wires the stored API key into createAnthropic (regression test for missing-key bug)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-test-key' })
    expect(mockModelBuilder).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('resolves "inherit" model to claude-sonnet-4-6 (a sensible default)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'inherit' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockModelBuilder).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('throws LLMError with kind=auth_missing when no API key is configured', async () => {
    const storeMod = await import('../../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: undefined })

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_missing' })
  })

  it('normalizes a 401 from the SDK into LLMError kind=auth_invalid', async () => {
    const sdkErr: any = new Error('Unauthorized')
    sdkErr.statusCode = 401
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'auth_invalid' })
  })

  it('normalizes a 429 from the SDK into LLMError kind=rate_limit', async () => {
    const sdkErr: any = new Error('Rate limited')
    sdkErr.statusCode = 429
    mockGenerateText.mockRejectedValue(sdkErr)

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'rate_limit' })
  })

  it('forwards AbortSignal to ai.generateText as abortSignal', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const controller = new AbortController()
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
    }))
  })

  it('omits system when systemPrompt is not provided', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const adapter = new AnthropicAdapter()
    await adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    const call = mockGenerateText.mock.calls[0][0]
    expect(call.system).toBeUndefined()
  })

  it('normalizes ECONNREFUSED into LLMError kind=network', async () => {
    const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:443')
    netErr.code = 'ECONNREFUSED'
    mockGenerateText.mockRejectedValue(netErr)

    const adapter = new AnthropicAdapter()
    await expect(adapter.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({ name: 'LLMError', kind: 'network' })
  })
})

describe('AnthropicAdapter.runAgentLoop', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return {
      fullStream: (async function* () {
        for (const c of chunks) yield c
      })(),
    }
  }

  it('yields text-delta events for each text chunk from the SDK fullStream', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'Hello' },
      { type: 'text-delta', textDelta: ' world' },
      { type: 'finish', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } },
    ]))

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ' world' },
      { type: 'done', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } },
    ])
  })

  it('yields tool-call + tool-result events when the SDK fullStream emits them', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'list_skills', args: { folderId: 1 } },
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'list_skills', result: { skills: [] } },
      { type: 'text-delta', textDelta: 'You have no skills.' },
      { type: 'finish', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } },
    ]))

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        messages: [{ role: 'user', content: 'list my skills' }],
        tools: [{
          name: 'list_skills',
          description: 'List skills',
          inputSchema: { type: 'object', properties: { folderId: { type: 'number' } } },
          execute: async () => ({ skills: [] }),
        }],
      },
    )) {
      events.push(ev)
    }

    expect(events).toEqual([
      { type: 'tool-call', id: 'call-1', name: 'list_skills', args: { folderId: 1 } },
      { type: 'tool-result', id: 'call-1', result: { skills: [] }, isError: false },
      { type: 'text-delta', delta: 'You have no skills.' },
      { type: 'done', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } },
    ])
  })

  it('passes tools through to the SDK in Vercel AI SDK format (name, description, parameters, execute)', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
    ]))

    const exec = vi.fn(async () => ({ ok: true }))
    const adapter = new AnthropicAdapter()
    for await (const _ of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      {
        messages: [{ role: 'user', content: 'use a tool' }],
        tools: [{
          name: 'my_tool',
          description: 'Does a thing',
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
          execute: exec,
        }],
      },
    )) {}

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools.my_tool).toBeDefined()
    expect(callArgs.tools.my_tool.description).toBe('Does a thing')
    expect(typeof callArgs.tools.my_tool.execute).toBe('function')
  })

  it('yields an error event when the SDK throws', async () => {
    mockStreamText.mockImplementation(() => { throw new Error('connection lost') })

    const adapter = new AnthropicAdapter()
    const events: any[] = []
    for await (const ev of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect(events[0].error.kind).toBe('unknown')
    expect(events[0].error.message).toContain('connection lost')
  })

  it('forwards AbortSignal as abortSignal to streamText', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } },
    ]))

    const controller = new AbortController()
    const adapter = new AnthropicAdapter()
    for await (const _ of adapter.runAgentLoop(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    )) {}

    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }))
  })
})

describe('AnthropicAdapter.streamText', () => {
  function fakeStream(chunks: Array<Record<string, unknown>>) {
    return {
      fullStream: (async function* () {
        for (const c of chunks) yield c
      })(),
    }
  }

  it('yields text-delta chunks only (ignores tool events)', async () => {
    mockStreamText.mockReturnValue(fakeStream([
      { type: 'text-delta', textDelta: 'Hello' },
      { type: 'tool-call', toolCallId: 'x', toolName: 'y', args: {} },
      { type: 'text-delta', textDelta: ' world' },
      { type: 'finish', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ]))

    const adapter = new AnthropicAdapter()
    const out: any[] = []
    for await (const c of adapter.streamText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      out.push(c)
    }

    expect(out).toEqual([
      { type: 'text-delta', delta: 'Hello' },
      { type: 'text-delta', delta: ' world' },
    ])
  })
})
