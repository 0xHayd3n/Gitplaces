import { stripCompareLine } from './parseCompareUrl'

export function stripMarkdownPreview(body: string, maxLength: number): string {
  if (!body) return ''

  let text = stripCompareLine(body)

  // Strip fenced code blocks first (they may contain other markdown chars).
  text = text.replace(/```[\s\S]*?```/g, ' ')

  // Strip images: ![alt](url) → ''
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // Replace links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Strip leading heading markers on each line.
  text = text.replace(/^\s*#{1,6}\s+/gm, '')

  // Strip emphasis markers (preserve inner text).
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Inline code: `code` → code
  text = text.replace(/`([^`]+)`/g, '$1')

  // Collapse all whitespace runs to a single space.
  text = text.replace(/\s+/g, ' ').trim()

  if (text.length <= maxLength) return text

  // Truncate to maxLength, preferring the last word boundary. If the slice
  // already ends at a word boundary (next char is whitespace), keep it whole.
  const slice = text.slice(0, maxLength)
  if (text[maxLength] === ' ') return slice
  const lastSpace = slice.lastIndexOf(' ')
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice
}
