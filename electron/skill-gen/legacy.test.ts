// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSkill, generateComponentsSkill, type SkillGenInput } from './legacy'

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

const baseInput: SkillGenInput = {
  owner: 'vercel',
  name: 'next.js',
  language: 'TypeScript',
  topics: ['react', 'ssr'],
  readme: 'Hello world',
  version: 'v14.0',
}

describe('generateSkill', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  it('calls the LLM with anthropic/claude-haiku-4-5 and max_tokens=2048 (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({
      text: '# skill',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    await generateSkill(baseInput)
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      expect.objectContaining({
        maxTokens: 2048,
        messages: [expect.objectContaining({ role: 'user' })],
      }),
    )
  })

  it('returns the text content from the LLM response', async () => {
    mockGenerateText.mockResolvedValue({
      text: '## [CORE]\nfoo\n## [EXTENDED]\nbar\n## [DEEP]\nbaz',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })
    const result = await generateSkill(baseInput)
    expect(result).toBe('## [CORE]\nfoo\n## [EXTENDED]\nbar\n## [DEEP]\nbaz')
  })

  it('truncates readme to 12000 characters', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const longReadme = 'x'.repeat(20000)
    await generateSkill({ ...baseInput, readme: longReadme })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    // The truncated readme (12000 chars) should appear, but not the full 20000
    expect(prompt).toContain('x'.repeat(12000))
    expect(prompt).not.toContain('x'.repeat(12001))
  })

  it('appends component prompt when isComponents and enabledComponents provided', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [CORE]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateSkill({ ...baseInput, isComponents: true, enabledComponents: ['Button', 'Input'] })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).toContain('Button, Input')
    expect(prompt).toContain('#### headings')
    expect(prompt).toContain('### ComponentName')
  })

  it('does not append component prompt when isComponents is false', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [CORE]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateSkill({ ...baseInput, isComponents: false })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).not.toContain('component library')
  })

  it('does not append component prompt when enabledComponents is absent', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [CORE]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateSkill({ ...baseInput, isComponents: true })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).not.toContain('ONLY for these enabled components')
  })

  it('does not append component prompt when enabledComponents is empty array', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [CORE]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateSkill({ ...baseInput, isComponents: true, enabledComponents: [] })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).not.toContain('ONLY for these enabled components')
  })
})

describe('generateComponentsSkill', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  it('calls the LLM with anthropic/claude-haiku-4-5 and max_tokens=4096 (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({
      text: '# Components skill',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    await generateComponentsSkill({ ...baseInput, isComponents: true })
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      expect.objectContaining({
        maxTokens: 4096,
        messages: [expect.objectContaining({ role: 'user' })],
      }),
    )
  })

  it('includes scanned component names and props in prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [COMPONENTS]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateComponentsSkill({
      ...baseInput,
      isComponents: true,
      scannedComponents: [
        { name: 'Button', props: [{ name: 'disabled', type: 'boolean', required: false }] },
        { name: 'Alert', props: [{ name: 'severity', type: 'string', required: true }] },
      ],
    })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).toContain('SCANNED COMPONENTS')
    expect(prompt).toContain('Button')
    expect(prompt).toContain('disabled (boolean, optional)')
    expect(prompt).toContain('Alert')
    expect(prompt).toContain('severity (string, required)')
  })

  it('includes defaultValue when present', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [COMPONENTS]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateComponentsSkill({
      ...baseInput,
      isComponents: true,
      scannedComponents: [
        { name: 'Toggle', props: [{ name: 'active', type: 'boolean', required: false, defaultValue: 'false' }] },
      ],
    })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).toContain('active (boolean, optional, default: false)')
  })

  it('falls back to README-only when scannedComponents is empty', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [COMPONENTS]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateComponentsSkill({ ...baseInput, isComponents: true, scannedComponents: [] })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).not.toContain('SCANNED COMPONENTS')
    expect(prompt).toContain('Document all components you can identify from the README')
  })

  it('falls back to README-only when scannedComponents is undefined', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [COMPONENTS]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateComponentsSkill({ ...baseInput, isComponents: true })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).not.toContain('SCANNED COMPONENTS')
    expect(prompt).toContain('Document all components you can identify from the README')
  })

  it('lists components with no props by name only', async () => {
    mockGenerateText.mockResolvedValue({ text: '## [COMPONENTS]\nok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await generateComponentsSkill({
      ...baseInput,
      isComponents: true,
      scannedComponents: [{ name: 'Divider', props: [] }],
    })
    const prompt = mockGenerateText.mock.calls[0][1].messages[0].content as string
    expect(prompt).toContain('- Divider: (no props extracted)')
  })
})

describe('legacy.ts SDK boundary (Phase 3 structural assertion)', () => {
  it('no longer imports @anthropic-ai/sdk anywhere', async () => {
    // After Phase 3 Task 4, no Anthropic-SDK code remains in legacy.ts.
    // All LLM calls route through electron/llm/.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.join(process.cwd(), 'electron/skill-gen/legacy.ts'),
      'utf-8',
    )
    expect(source).not.toContain('new Anthropic(')
    expect(source).not.toContain('@anthropic-ai/sdk')
  })
})
