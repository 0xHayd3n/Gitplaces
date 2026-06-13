// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { HOST_ID_GITHUB } from './types'
import { getProvider, getDefaultProvider } from './registry'
import { GitHubProvider } from './github'

describe('registry', () => {
  it('getProvider returns the GitHub provider for HOST_ID_GITHUB', () => {
    const p = getProvider(HOST_ID_GITHUB)
    expect(p).toBeInstanceOf(GitHubProvider)
  })

  it('getProvider memoizes the same instance', () => {
    const a = getProvider(HOST_ID_GITHUB)
    const b = getProvider(HOST_ID_GITHUB)
    expect(a).toBe(b)
  })

  it('getProvider returns null for unknown host ids', () => {
    expect(getProvider('gl:gitlab.com')).toBeNull()
  })

  it('getDefaultProvider returns the GitHub provider', () => {
    expect(getDefaultProvider()).toBeInstanceOf(GitHubProvider)
  })
})
