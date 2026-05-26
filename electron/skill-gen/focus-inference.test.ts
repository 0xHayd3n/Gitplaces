import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./legacy', () => ({
  generateWithRawPrompt: vi.fn(),
}))

import { inferFocusInstructions } from './focus-inference'
import { generateWithRawPrompt } from './legacy'
import type { ExtractionResult } from './types'

const mockGenerate = vi.mocked(generateWithRawPrompt)

const libraryExtraction: ExtractionResult = {
  repoType: 'library',
  manifest: { ecosystem: 'node', name: 'zod' },
  fileTree: ['src/index.ts'],
  exports: [
    { name: 'z', kind: 'function', file: 'src/index.ts' },
    { name: 'ZodString', kind: 'class', file: 'src/index.ts' },
    { name: 'ZodNumber', kind: 'class', file: 'src/index.ts' },
  ],
}

const genericNoExports: ExtractionResult = {
  repoType: 'generic',
  manifest: { ecosystem: 'unknown' },
  fileTree: [],
}

describe('inferFocusInstructions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns bullet points from Haiku for a library with exports', async () => {
    mockGenerate.mockResolvedValue('- Schema validation library\n- Focus on z.object() and z.string()\n- Show parse vs safeParse patterns')
    const result = await inferFocusInstructions('library', libraryExtraction, 'Zod is a TypeScript-first schema validation library', {})
    expect(result).toContain('Schema validation')
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining('Repo type: library'),
      '',
      expect.objectContaining({ model: 'claude-haiku-4-5', maxTokens: 200 })
    )
  })

  it('returns null for generic type with no exports', async () => {
    const result = await inferFocusInstructions('generic', genericNoExports, 'Some readme', {})
    expect(result).toBeNull()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('returns null when generateWithRawPrompt throws', async () => {
    mockGenerate.mockRejectedValue(new Error('API error'))
    const result = await inferFocusInstructions('library', libraryExtraction, 'readme', {})
    expect(result).toBeNull()
  })

  it('includes export names in the prompt', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', libraryExtraction, 'readme', {})
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).toContain('z (function)')
    expect(prompt).toContain('ZodString (class)')
  })

  it('caps exports at 20 in the prompt', async () => {
    const manyExports: ExtractionResult = {
      ...libraryExtraction,
      exports: Array.from({ length: 30 }, (_, i) => ({
        name: `fn${i}`, kind: 'function' as const, file: 'src/index.ts',
      })),
    }
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', manyExports, 'readme', {})
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).toContain('fn0')
    expect(prompt).toContain('fn19')
    expect(prompt).not.toContain('fn20')
  })

  it('includes Category line when typeBucket and typeSub are provided', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', libraryExtraction, 'readme', {
      typeBucket: 'ai-ml',
      typeSub: 'orm',
    })
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).toContain('Category: ai-ml / orm')
  })

  it('includes Category line with only typeBucket when typeSub is absent', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', libraryExtraction, 'readme', {
      typeBucket: 'frameworks',
    })
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).toContain('Category: frameworks')
    expect(prompt).not.toContain('Category: frameworks /')
  })

  it('omits Category line when neither typeBucket nor typeSub provided', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', libraryExtraction, 'readme', {})
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).not.toContain('Category:')
  })

  it('includes Category line with only typeSub when typeBucket is absent', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    await inferFocusInstructions('library', libraryExtraction, 'readme', {
      typeSub: 'orm',
    })
    const prompt = mockGenerate.mock.calls[0][0]
    expect(prompt).toContain('Category: orm')
    expect(prompt).not.toContain('/')
  })

  it('attempts inference for generic repo with no exports when typeSub is present', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    const result = await inferFocusInstructions('generic', genericNoExports, 'readme', {
      typeSub: 'docker-compose',
    })
    expect(result).toBe('- bullet point')
    expect(mockGenerate).toHaveBeenCalled()
  })

  it('attempts inference for generic repo with no exports when typeBucket is present', async () => {
    mockGenerate.mockResolvedValue('- bullet point')
    const result = await inferFocusInstructions('generic', genericNoExports, 'readme', {
      typeBucket: 'infrastructure',
    })
    expect(result).toBe('- bullet point')
    expect(mockGenerate).toHaveBeenCalled()
  })

  it('still returns null for generic repo with no exports and no subtypes', async () => {
    const result = await inferFocusInstructions('generic', genericNoExports, 'readme', {})
    expect(result).toBeNull()
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
