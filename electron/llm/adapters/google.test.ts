// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreateGoogle, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreateGoogle: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
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
