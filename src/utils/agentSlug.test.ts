import { describe, it, expect } from 'vitest'
import { slugifyName, dedupeHandle, isValidHandle } from './agentSlug'

describe('slugifyName', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyName('Code Investigator')).toBe('code-investigator')
  })

  it('collapses repeated whitespace into a single dash', () => {
    expect(slugifyName('Email   Drafter')).toBe('email-drafter')
  })

  it('strips characters outside [a-z0-9-]', () => {
    expect(slugifyName('Hey! Therapist?')).toBe('hey-therapist')
  })

  it('trims leading/trailing dashes', () => {
    expect(slugifyName('  --hello-- ')).toBe('hello')
  })

  it('falls back to "untitled-agent" for empty/whitespace-only input', () => {
    expect(slugifyName('')).toBe('untitled-agent')
    expect(slugifyName('   ')).toBe('untitled-agent')
    expect(slugifyName('!!!')).toBe('untitled-agent')
  })

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100)
    expect(slugifyName(long).length).toBe(64)
  })
})

describe('dedupeHandle', () => {
  it('returns input when no collision', () => {
    expect(dedupeHandle('foo', ['bar', 'baz'])).toBe('foo')
  })

  it('appends -2 on first collision', () => {
    expect(dedupeHandle('foo', ['foo'])).toBe('foo-2')
  })

  it('keeps incrementing until unused', () => {
    expect(dedupeHandle('foo', ['foo', 'foo-2', 'foo-3'])).toBe('foo-4')
  })

  it('handles a base that already ends with a numeric suffix', () => {
    expect(dedupeHandle('agent-1', ['agent-1'])).toBe('agent-1-2')
  })

  it('is case-insensitive against the taken set', () => {
    expect(dedupeHandle('Foo', ['foo'])).toBe('foo-2')
  })
})

describe('isValidHandle', () => {
  it('accepts lowercase letters, digits, dashes', () => {
    expect(isValidHandle('foo-bar-2')).toBe(true)
    expect(isValidHandle('a')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidHandle('')).toBe(false)
  })

  it('rejects uppercase, spaces, special chars', () => {
    expect(isValidHandle('Foo')).toBe(false)
    expect(isValidHandle('foo bar')).toBe(false)
    expect(isValidHandle('foo!')).toBe(false)
  })

  it('rejects leading dash', () => {
    expect(isValidHandle('-foo')).toBe(false)
  })

  it('rejects > 64 chars', () => {
    expect(isValidHandle('a'.repeat(65))).toBe(false)
  })
})
