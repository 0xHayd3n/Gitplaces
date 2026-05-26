// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockHandle, registered } = vi.hoisted(() => {
  const registered = new Map<string, (...args: any[]) => unknown>()
  return {
    registered,
    mockHandle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      registered.set(channel, handler)
    }),
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('../store', () => ({
  getProviderConfig: vi.fn(),
  setProviderConfig: vi.fn(),
  listOpenAICompatibleEndpoints: vi.fn(() => []),
  upsertOpenAICompatibleEndpoint: vi.fn(),
  removeOpenAICompatibleEndpoint: vi.fn(),
  getDefault: vi.fn(),
  setDefault: vi.fn(),
}))

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
  LLMError: class LLMError extends Error {
    kind: string
    constructor(kind: string, message: string) {
      super(message)
      this.name = 'LLMError'
      this.kind = kind
    }
  },
}))

import { registerLLMHandlers } from './llmHandlers'

beforeEach(() => {
  registered.clear()
  mockHandle.mockClear()
  mockGenerateText.mockReset()
  registerLLMHandlers()
})

describe('llmHandlers — registration', () => {
  it('registers every llm:* channel', () => {
    const channels = Array.from(registered.keys()).sort()
    expect(channels).toEqual([
      'llm:getDefault',
      'llm:getProviderConfig',
      'llm:listOpenAICompatibleEndpoints',
      'llm:listProviders',
      'llm:removeOpenAICompatibleEndpoint',
      'llm:setDefault',
      'llm:setProviderConfig',
      'llm:testConnection',
      'llm:upsertOpenAICompatibleEndpoint',
    ])
  })
})

describe('llm:listProviders', () => {
  it('returns the 5 known provider ids', async () => {
    const handler = registered.get('llm:listProviders')!
    const ids = await handler(null)
    expect(ids).toEqual(['anthropic', 'openai', 'google', 'opencode', 'openai-compatible'])
  })
})

describe('llm:getProviderConfig', () => {
  it('proxies to the store helper', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getProviderConfig).mockReturnValueOnce({ enabled: true, apiKey: 'sk-test' })

    const handler = registered.get('llm:getProviderConfig')!
    const cfg = await handler(null, 'openai')
    expect(cfg).toEqual({ enabled: true, apiKey: 'sk-test' })
    expect(storeMod.getProviderConfig).toHaveBeenCalledWith('openai')
  })

  it('rejects unknown provider ids', async () => {
    const handler = registered.get('llm:getProviderConfig')!
    await expect(handler(null, 'mystery')).rejects.toThrow(/provider/i)
  })
})

describe('llm:setProviderConfig', () => {
  it('proxies to the store helper', async () => {
    const storeMod = await import('../store')
    const handler = registered.get('llm:setProviderConfig')!
    await handler(null, 'openai', { enabled: true, apiKey: 'sk-new' })
    expect(storeMod.setProviderConfig).toHaveBeenCalledWith('openai', { enabled: true, apiKey: 'sk-new' })
  })
})

describe('llm:testConnection', () => {
  it('returns { ok: true } when the LLM responds', async () => {
    mockGenerateText.mockResolvedValue({ text: 'pong', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const handler = registered.get('llm:testConnection')!
    const result = await handler(null, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(result).toMatchObject({ ok: true })
  })

  it('returns { ok: false, kind, message } when the LLM throws an LLMError', async () => {
    const { LLMError } = await import('../llm')
    mockGenerateText.mockRejectedValue(new LLMError('auth_invalid' as any, 'Bad key'))
    const handler = registered.get('llm:testConnection')!
    const result = await handler(null, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(result).toMatchObject({ ok: false, kind: 'auth_invalid', message: expect.stringContaining('Bad key') })
  })
})
