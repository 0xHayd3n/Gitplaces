export interface SemverParts {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/i

export function parseSemverTag(tag: string): SemverParts | null {
  if (!tag) return null
  const match = tag.match(SEMVER_RE)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}
