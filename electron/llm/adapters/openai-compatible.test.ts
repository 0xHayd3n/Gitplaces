// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGenerateText, mockCreate, mockModelBuilder } = vi.hoisted(() => {
  const mockModelBuilder = vi.fn((modelId: string) => ({ __isMockedModel: true, modelId }))
  return {
    mockGenerateText: vi.fn(),
    mockCreate: vi.fn(() => mockModelBuilder),
    mockModelBuilder,
  }
})

vi.mock('ai', () => ({
  generateText: mockGenerateText,
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
