import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAnatomy, parseMemory } from './parse'

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8')

describe('parseAnatomy', () => {
  it('extracts identity, generated, rules, decisions', () => {
    const m = parseAnatomy(fx('sample.anatomy'))
    expect(m.identity.form).toBe('library')
    expect(m.generated.commit).toBe('deadbeefcafe')
    expect(m.rules).toHaveLength(1)
    expect(m.rules[0].statement).toMatch(/electron\/db\.ts/)
    expect(m.rules[0].verify?.kind).toBe('glob')
    expect(m.decisions[0].decision).toBe('Serve anatomy verbatim')
  })

  it('throws a typed error on malformed TOML', () => {
    expect(() => parseAnatomy(fx('malformed.anatomy'))).toThrow(/anatomy parse/i)
  })

  it('tolerates missing optional tables', () => {
    const m = parseAnatomy('[identity]\nform="x"\n[generated]\ncommit="c"\n')
    expect(m.rules).toEqual([])
    expect(m.decisions).toEqual([])
    expect(m.operation).toBeUndefined()
  })
})

describe('parseMemory', () => {
  it('parses entries and superseded flag', () => {
    const e = parseMemory(fx('sample.anatomy-memory'))
    expect(e).toHaveLength(2)
    expect(e[0].kind).toBe('gotcha')
    expect(e[1].superseded).toBe(true)
  })

  it('returns [] for null input', () => {
    expect(parseMemory(null)).toEqual([])
  })
})
