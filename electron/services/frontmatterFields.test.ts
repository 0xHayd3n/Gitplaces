// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { parseAgentModel, parseModelFrontmatter } from './frontmatterFields'

describe('parseAgentModel', () => {
  it('parses legacy short names as anthropic', () => {
    expect(parseAgentModel('sonnet')).toEqual({ model: 'sonnet', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('opus')).toEqual({ model: 'opus', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('haiku')).toEqual({ model: 'haiku', provider: 'anthropic', endpoint: null })
  })

  it('parses "inherit" as anthropic with model="inherit"', () => {
    expect(parseAgentModel('inherit')).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
  })

  it('preserves full Anthropic IDs as anthropic', () => {
    expect(parseAgentModel('claude-sonnet-4-6')).toEqual({ model: 'claude-sonnet-4-6', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('claude-opus-4-7')).toEqual({ model: 'claude-opus-4-7', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel('claude-haiku-4-5-20251001')).toEqual({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic', endpoint: null })
  })

  it('parses explicit provider/model form', () => {
    expect(parseAgentModel('openai/gpt-4o')).toEqual({ model: 'openai/gpt-4o', provider: 'openai', endpoint: null })
    expect(parseAgentModel('google/gemini-2.5-pro')).toEqual({ model: 'google/gemini-2.5-pro', provider: 'google', endpoint: null })
    expect(parseAgentModel('opencode/claude-sonnet-4-6')).toEqual({ model: 'opencode/claude-sonnet-4-6', provider: 'opencode', endpoint: null })
  })

  it('parses openai-compatible with endpoint', () => {
    expect(parseAgentModel('openai-compatible:ollama-local/llama3.1:70b')).toEqual({
      model: 'openai-compatible:ollama-local/llama3.1:70b',
      provider: 'openai-compatible',
      endpoint: 'ollama-local',
    })
  })

  it('parses openai-compatible without endpoint', () => {
    expect(parseAgentModel('openai-compatible/llama3.1:70b')).toEqual({
      model: 'openai-compatible/llama3.1:70b',
      provider: 'openai-compatible',
      endpoint: null,
    })
  })

  it('falls back to inherit + warning for unknown values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAgentModel('bogus-not-a-model')).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back to inherit + warning for non-string input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAgentModel(undefined)).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    expect(parseAgentModel(42)).toEqual({ model: 'inherit', provider: 'anthropic', endpoint: null })
    warn.mockRestore()
  })
})

describe('parseModelFrontmatter (legacy, still exported)', () => {
  it('keeps returning the 4-value short for back-compat consumers', () => {
    expect(parseModelFrontmatter('sonnet')).toBe('sonnet')
    expect(parseModelFrontmatter('claude-sonnet-4-6')).toBe('sonnet')
    expect(parseModelFrontmatter('inherit')).toBe('inherit')
    expect(parseModelFrontmatter('openai/gpt-4o')).toBe('inherit') // non-anthropic falls back to inherit
  })
})
