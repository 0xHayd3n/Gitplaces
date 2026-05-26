// src/lib/fileTree/search.ts

/**
 * Find all case-insensitive substring matches of `query` in `text`.
 * Returns ranges as [start, endExclusive] pairs.
 */
export function findMatchRanges(text: string, query: string): [number, number][] {
  if (!query) return []
  const ranges: [number, number][] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let idx = 0
  while (idx <= lowerText.length - lowerQuery.length) {
    const found = lowerText.indexOf(lowerQuery, idx)
    if (found === -1) break
    ranges.push([found, found + lowerQuery.length])
    idx = found + lowerQuery.length
  }
  return ranges
}

/**
 * Does the path (any segment of it) contain `query` case-insensitively?
 */
export function pathMatchesQuery(path: string, query: string): boolean {
  if (!query) return true
  return path.toLowerCase().includes(query.toLowerCase())
}

/**
 * Returns all ancestor paths of `path`, ordered shallow-to-deep.
 * For 'a/b/c/foo.ts' → ['a', 'a/b', 'a/b/c'].
 */
export function ancestorPaths(path: string): string[] {
  const segments = path.split('/')
  if (segments.length < 2) return []
  const result: string[] = []
  let acc = ''
  for (let i = 0; i < segments.length - 1; i++) {
    acc = acc ? `${acc}/${segments[i]}` : segments[i]
    result.push(acc)
  }
  return result
}
