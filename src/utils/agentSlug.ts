const HANDLE_MAX = 64
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slugifyName(name: string): string {
  const lower = name.toLowerCase()
  const cleaned = lower
    .replace(/[^a-z0-9]+/g, '-')  // any run of non-alphanumeric → single dash
    .replace(/^-+|-+$/g, '')      // trim leading/trailing dashes
  if (cleaned.length === 0) return 'untitled-agent'
  return cleaned.slice(0, HANDLE_MAX)
}

export function dedupeHandle(handle: string, taken: readonly string[]): string {
  const lowerTaken = new Set(taken.map(h => h.toLowerCase()))
  const base = handle.toLowerCase()
  if (!lowerTaken.has(base)) return base
  let i = 2
  while (lowerTaken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle)
}
