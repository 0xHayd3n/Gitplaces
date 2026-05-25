// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreateAnthropic, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreateAnthropic: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
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
})
