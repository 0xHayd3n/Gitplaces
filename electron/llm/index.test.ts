// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAnthropicGen } = vi.hoisted(() => ({
  mockAnthropicGen: vi.fn(),
}))

vi.mock('./adapters/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockAnthropicGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { createLLMService } from './index'
import { LLMError } from './types'

beforeEach(() => {
  mockAnthropicGen.mockReset()
})

describe('createLLMService', () => {
  it('returns an LLMService with generateText / streamText / runAgentLoop', () => {
    const svc = createLLMService()
    expect(typeof svc.generateText).toBe('function')
    expect(typeof svc.streamText).toBe('function')
    expect(typeof svc.runAgentLoop).toBe('function')
  })

  it('dispatches an anthropic ModelRef to the Anthropic adapter', async () => {
    mockAnthropicGen.mockResolvedValue({
      text: 'hi',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })

    const svc = createLLMService()
    const out = await svc.generateText(
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hello' }] },
    )

    expect(mockAnthropicGen).toHaveBeenCalledTimes(1)
    expect(out.text).toBe('hi')
  })

  it('throws LLMError kind=unknown for a provider that has no adapter yet (openai in Phase 1)', async () => {
    const svc = createLLMService()
    await expect(svc.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'unknown',
    })
  })
})
