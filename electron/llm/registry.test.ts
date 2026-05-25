// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseModelRef, formatModelRef } from './registry'

describe('parseModelRef', () => {
  it('maps legacy "sonnet" to anthropic/claude-sonnet-4-6', () => {
    expect(parseModelRef('sonnet')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
  })

  it('maps legacy "opus" to anthropic/claude-opus-4-7', () => {
    expect(parseModelRef('opus')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    })
  })

  it('maps legacy "haiku" to anthropic/claude-haiku-4-5', () => {
    expect(parseModelRef('haiku')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    })
  })

  it('returns "inherit" provider for the literal string "inherit"', () => {
    // Special sentinel value — caller resolves the actual model at runtime.
    expect(parseModelRef('inherit')).toEqual({
      provider: 'anthropic',
      model: 'inherit',
    })
  })

  it('parses explicit provider/model form', () => {
    expect(parseModelRef('openai/gpt-4o')).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(parseModelRef('anthropic/claude-sonnet-4-6')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(parseModelRef('google/gemini-2.5-pro')).toEqual({
      provider: 'google',
      model: 'gemini-2.5-pro',
    })
    expect(parseModelRef('opencode/claude-sonnet-4-6')).toEqual({
      provider: 'opencode',
      model: 'claude-sonnet-4-6',
    })
  })

  it('preserves colons inside the model name (local model tags like llama3.1:70b)', () => {
    expect(parseModelRef('openai-compatible:ollama-local/llama3.1:70b')).toEqual({
      provider: 'openai-compatible',
      endpoint: 'ollama-local',
      model: 'llama3.1:70b',
    })
  })

  it('parses openai-compatible with no endpoint segment', () => {
    expect(parseModelRef('openai-compatible/llama3.1:70b')).toEqual({
      provider: 'openai-compatible',
      model: 'llama3.1:70b',
    })
  })

  it('rejects unknown provider', () => {
    expect(() => parseModelRef('mystery/foo')).toThrow(/unknown provider/i)
  })

  it('rejects endpoint segment on non-openai-compatible provider', () => {
    expect(() => parseModelRef('openai:org-1/gpt-4o')).toThrow(/endpoint.*openai-compatible/i)
  })

  it('rejects missing slash', () => {
    expect(() => parseModelRef('openai-gpt-4o')).toThrow(/expected.*provider\/model/i)
  })

  it('rejects empty model segment', () => {
    expect(() => parseModelRef('openai/')).toThrow(/model.*empty/i)
  })
})

describe('formatModelRef', () => {
  it('round-trips a simple ref', () => {
    const ref = { provider: 'openai' as const, model: 'gpt-4o' }
    expect(formatModelRef(ref)).toBe('openai/gpt-4o')
  })

  it('round-trips an openai-compatible ref with endpoint', () => {
    const ref = { provider: 'openai-compatible' as const, endpoint: 'ollama-local', model: 'llama3.1:70b' }
    expect(formatModelRef(ref)).toBe('openai-compatible:ollama-local/llama3.1:70b')
  })

  it('round-trips an openai-compatible ref without endpoint', () => {
    const ref = { provider: 'openai-compatible' as const, model: 'llama3.1:70b' }
    expect(formatModelRef(ref)).toBe('openai-compatible/llama3.1:70b')
  })
})
