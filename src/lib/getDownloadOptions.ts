export interface DownloadOption {
  id: 'zip' | 'epub' | 'pdf' | 'docx' | 'bookmarks' | 'clone' | 'folder'
  label: string
  icon: string
  isDefault: boolean
}

const EPUB_DEFAULT = new Set(['book'])
const PDF_DEFAULT = new Set(['tutorial', 'course', 'cheatsheet', 'interview-prep', 'research-paper'])
const BOOKMARKS_DEFAULT = new Set(['awesome-list'])
const HAS_EPUB = new Set(['book', 'tutorial', 'course'])
const HAS_DOCX = new Set(['book', 'tutorial', 'course', 'cheatsheet', 'interview-prep', 'research-paper'])
const HAS_PDF = new Set(['book', 'tutorial', 'course', 'cheatsheet', 'interview-prep', 'research-paper', 'awesome-list', 'roadmap', 'coding-challenge'])

const ALWAYS: DownloadOption[] = [
  { id: 'zip',    label: 'Download as ZIP',       icon: 'archive',     isDefault: false },
  { id: 'clone',  label: 'Copy clone command',    icon: 'clipboard',   isDefault: false },
  { id: 'folder', label: 'Download folder\u2026', icon: 'folder-down', isDefault: false },
]

export function getDownloadOptions(typeBucket: string, typeSub: string | null): DownloadOption[] {
  if (typeBucket !== 'learning' || typeSub == null) {
    return ALWAYS.map(o => o.id === 'zip' ? { ...o, isDefault: true } : o)
  }

  const defaultId: DownloadOption['id'] =
    EPUB_DEFAULT.has(typeSub) ? 'epub' :
    PDF_DEFAULT.has(typeSub) ? 'pdf' :
    BOOKMARKS_DEFAULT.has(typeSub) ? 'bookmarks' :
    'zip'

  const options: DownloadOption[] = []

  if (HAS_EPUB.has(typeSub)) {
    options.push({ id: 'epub', label: 'Download as ePub', icon: 'book-open', isDefault: defaultId === 'epub' })
  }
  if (HAS_PDF.has(typeSub)) {
    options.push({ id: 'pdf', label: 'Download as PDF', icon: 'file-text', isDefault: defaultId === 'pdf' })
  }
  if (HAS_DOCX.has(typeSub)) {
    // docx is offered but never the computed default (no DOCX_DEFAULT set), so isDefault is always false.
    options.push({ id: 'docx', label: 'Download as Word', icon: 'file-type', isDefault: false })
  }
  if (BOOKMARKS_DEFAULT.has(typeSub)) {
    options.push({ id: 'bookmarks', label: 'Export as Bookmarks', icon: 'bookmark', isDefault: defaultId === 'bookmarks' })
  }

  options.push(...ALWAYS.map(o => o.id === 'zip' && defaultId === 'zip' ? { ...o, isDefault: true } : o))
  options.sort((a, b) => (a.isDefault ? -1 : 0) - (b.isDefault ? -1 : 0))

  return options
}
