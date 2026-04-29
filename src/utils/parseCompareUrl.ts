// GitHub release bodies often end with auto-generated lines like:
//   **Full Changelog**: https://github.com/owner/repo/compare/v1.0.0...v1.1.0
// or, for a first release with no prior tag:
//   **Full Changelog**: https://github.com/owner/repo/commits/v0.1.0
// We extract the refs so the UI can render a structured before/after summary
// and strip the raw URL line from the rendered markdown.

export type ParsedCompare =
  | { kind: 'compare'; owner: string; repo: string; base: string; head: string }
  | { kind: 'commits'; owner: string; repo: string; base: null; head: string }

// Tag names can include dots, slashes, and hyphens. We match greedily up to the
// `...` separator (compare) or the end of the URL (commits-only).
const COMPARE_RE  = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/compare\/([^\s)]+?)\.\.\.([^\s)]+)/
const COMMITS_RE  = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/commits\/([^\s)]+)/

export function parseCompareUrl(body: string): ParsedCompare | null {
  if (!body) return null

  const cmp = body.match(COMPARE_RE)
  if (cmp) {
    return { kind: 'compare', owner: cmp[1], repo: cmp[2], base: cmp[3], head: cmp[4] }
  }

  const com = body.match(COMMITS_RE)
  if (com) {
    return { kind: 'commits', owner: com[1], repo: com[2], base: null, head: com[3] }
  }

  return null
}

// Anchored to the auto-generated GitHub line shape:
//   **Full Changelog**: <url>
// The label is matched (with optional whitespace) so we don't strip mid-
// paragraph compare links the author intentionally embedded.
const FULL_CHANGELOG_LINE_RE = /^\s*(?:[*_]{1,2})?\s*Full\s+Changelog\s*(?:[*_]{1,2})?\s*:\s*(?:https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:compare|commits)\/[^\s)]+)\s*$/i

export function stripCompareLine(body: string): string {
  if (!body) return body
  const lines = body.split('\n')
  const filtered = lines.filter(line => !FULL_CHANGELOG_LINE_RE.test(line))
  // Trim leading/trailing blank lines that may be left behind.
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
    filtered.pop()
  }
  while (filtered.length > 0 && filtered[0].trim() === '') {
    filtered.shift()
  }
  return filtered.join('\n')
}
