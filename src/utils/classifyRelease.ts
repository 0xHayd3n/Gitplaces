import { parseSemverTag } from './parseSemverTag'

export type ReleaseTier = 'major' | 'normal' | 'prerelease'

export function classifyRelease(opts: {
  tagName: string
  prereleaseFlag: boolean
}): ReleaseTier {
  if (opts.prereleaseFlag) return 'prerelease'
  const parts = parseSemverTag(opts.tagName)
  if (
    parts !== null &&
    parts.prerelease === null &&
    parts.major >= 1 &&
    parts.minor === 0 &&
    parts.patch === 0
  ) {
    return 'major'
  }
  return 'normal'
}
