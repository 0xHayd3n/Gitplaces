// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('./llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { extractTags } from './tag-extractor'

beforeEach(() => {
  mockGenerateText.mockReset()
})

describe('extractTags', () => {
  it('returns parsed JSON tags from the LLM response', async () => {
    mockGenerateText.mockResolvedValue({
      text: '["http", "python", "async"]',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    const tags = await extractTags('fast HTTP client for Python', [])
    expect(tags).toEqual(['http', 'python', 'async'])
  })

  it('falls back to word split when response is invalid JSON', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'not valid json',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })
    const tags = await extractTags('parse csv files fast', [])
    expect(tags).toContain('parse')
    expect(tags).toContain('csv')
    expect(tags).toContain('files')
  })

  it('calls the LLM with the expected model + max_tokens (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({ text: '[]', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await extractTags('test query', ['foo', 'bar'])
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      expect.objectContaining({
        maxTokens: 256,
        messages: [expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('User query: "test query"'),
        })],
      }),
    )
  })

  it('includes the known topics list in the prompt (capped at 300)', async () => {
    mockGenerateText.mockResolvedValue({ text: '[]', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const topics = Array.from({ length: 500 }, (_, i) => `topic-${i}`)
    await extractTags('q', topics)
    const call = mockGenerateText.mock.calls[0][1]
    const promptContent = call.messages[0].content as string
    expect(promptContent).toContain('topic-0')
    expect(promptContent).toContain('topic-299')
    expect(promptContent).not.toContain('topic-300')
  })
})
