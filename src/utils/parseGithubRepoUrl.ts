const SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const MAX_SEGMENT_LEN = 100

export function parseGithubRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // SSH: git@github.com:owner/repo[.git][/]
  const ssh = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  if (ssh) return validate(ssh[1], ssh[2])

  // HTTP(S): http(s)://github.com/owner/repo[.git][/anything]
  const http = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i)
  if (http) return validate(http[1], http[2])

  // Bare host: github.com/owner/repo[/anything]
  const host = trimmed.match(/^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i)
  if (host) return validate(host[1], host[2])

  // Bare owner/repo — strictly 2 segments, no extras.
  const bare = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (bare) return validate(bare[1], bare[2])

  return null
}

function validate(owner: string, name: string): { owner: string; name: string } | null {
  const cleanName = name.replace(/\.git$/i, '')
  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(cleanName)) return null
  if (owner.startsWith('.') || cleanName.startsWith('.')) return null
  if (owner.length > MAX_SEGMENT_LEN || cleanName.length > MAX_SEGMENT_LEN) return null
  return { owner, name: cleanName }
}
