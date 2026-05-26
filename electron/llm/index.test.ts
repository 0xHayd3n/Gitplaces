// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockAnthropicGen, mockOpenAIGen, mockGoogleGen, mockOpenAICompatGen } = vi.hoisted(() => ({
  mockAnthropicGen: vi.fn(),
  mockOpenAIGen: vi.fn(),
  mockGoogleGen: vi.fn(),
  mockOpenAICompatGen: vi.fn(),
}))

vi.mock('./adapters/anthropic', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockAnthropicGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./adapters/openai', () => ({
  OpenAIAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockOpenAIGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./adapters/google', () => ({
  GoogleAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockGoogleGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./adapters/openai-compatible', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(() => ({
    generateText: mockOpenAICompatGen,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

vi.mock('./runner', () => ({
  runAgentLoop: vi.fn(async function* (adapter, ref, opts) {
    yield* adapter.runAgentLoop(ref, opts)
  }),
}))

import { createLLMService } from './index'
import { LLMError } from './types'

beforeEach(() => {
  mockAnthropicGen.mockReset()
  mockOpenAIGen.mockReset()
  mockGoogleGen.mockReset()
  mockOpenAICompatGen.mockReset()
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

  it('dispatches an openai ModelRef to the OpenAI adapter', async () => {
    mockOpenAIGen.mockResolvedValue({ text: 'gpt', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const svc = createLLMService()
    await svc.generateText(
      { provider: 'openai', model: 'gpt-4o' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockOpenAIGen).toHaveBeenCalledTimes(1)
    expect(mockAnthropicGen).not.toHaveBeenCalled()
  })

  it('dispatches a google ModelRef to the Google adapter', async () => {
    mockGoogleGen.mockResolvedValue({ text: 'gemini', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const svc = createLLMService()
    await svc.generateText(
      { provider: 'google', model: 'gemini-2.5-pro' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockGoogleGen).toHaveBeenCalledTimes(1)
  })

  it('dispatches an openai-compatible ModelRef to the OpenAICompatible adapter', async () => {
    mockOpenAICompatGen.mockResolvedValue({ text: 'llama', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const svc = createLLMService()
    await svc.generateText(
      { provider: 'openai-compatible', endpoint: 'ollama-local', model: 'llama3.1' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    expect(mockOpenAICompatGen).toHaveBeenCalledTimes(1)
  })

  it('throws a clear error if opencode reaches the in-app runner (it should use CLI dispatch instead)', async () => {
    const svc = createLLMService()
    await expect(svc.generateText(
      { provider: 'opencode', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'unknown',
      message: expect.stringContaining('CLI subprocess'),
    })
  })

  it('streamText surfaces resolveAdapter throws as a rejected iterable, not a sync exception', async () => {
    const svc = createLLMService()
    const iter = svc.streamText(
      { provider: 'opencode', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    // Calling streamText must NOT throw synchronously — the call returns an iterator.
    // The error surfaces on the first iteration.
    await expect((async () => { for await (const _ of iter) { /* unreachable */ } })()).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'unknown',
    })
  })

  it('runAgentLoop surfaces resolveAdapter throws as a rejected iterable, not a sync exception', async () => {
    const svc = createLLMService()
    const iter = svc.runAgentLoop(
      { provider: 'opencode', model: 'claude-sonnet-4-6' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    await expect((async () => { for await (const _ of iter) { /* unreachable */ } })()).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'unknown',
    })
  })
})
