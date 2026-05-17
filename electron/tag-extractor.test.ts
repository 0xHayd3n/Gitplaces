import { describe, it, expect, vi } from 'vitest'

// Mock the SDK before importing the module under test
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '["http", "python", "async"]' }],
      }),
    },
  })),
}))

import { extractTags } from './tag-extractor'

describe('extractTags', () => {
  it('returns parsed JSON tags from Haiku response', async () => {
    const tags = await extractTags('fast HTTP client for Python', [], 'sk-test')
    expect(tags).toEqual(['http', 'python', 'async'])
  })

  it('falls back to word split when response is invalid JSON', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as ReturnType<typeof vi.fn>
    Anthropic.mockImplementationOnce(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'not valid json' }],
        }),
      },
    }))
    const tags = await extractTags('parse csv files fast', [], 'sk-test')
    expect(tags).toContain('parse')
    expect(tags).toContain('csv')
    expect(tags).toContain('files')
  })
})
