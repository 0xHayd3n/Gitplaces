// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { repoRowId } from './db-helpers'

describe('repoRowId', () => {
  it('public github.com returns the bare native id (preserves existing PK format)', () => {
    expect(repoRowId('gh:api.github.com', 42)).toBe('42')
    expect(repoRowId('gh:api.github.com', '42')).toBe('42')
  })

  it('GitLab.com prefixes the host id', () => {
    expect(repoRowId('gl:gitlab.com', 42)).toBe('gl:gitlab.com:42')
  })

  it('Codeberg (Gitea) prefixes the host id', () => {
    expect(repoRowId('gt:codeberg.org', 7)).toBe('gt:codeberg.org:7')
  })

  it('GHE prefixes — distinct id space from public github.com', () => {
    expect(repoRowId('gh:github.acme.com/api/v3', 42)).toBe('gh:github.acme.com/api/v3:42')
  })

  it('coerces numeric native ids to strings', () => {
    const out = repoRowId('gl:gitlab.com', 100_000)
    expect(typeof out).toBe('string')
    expect(out).toBe('gl:gitlab.com:100000')
  })
})
