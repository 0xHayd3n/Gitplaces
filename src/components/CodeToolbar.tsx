// src/components/CodeToolbar.tsx
import { useState, useCallback } from 'react'
import { Clipboard, Check, WrapText, AlignLeft } from 'lucide-react'
import { formatBytes } from '../utils/formatBytes'

interface Props {
  language: string
  lineCount: number
  fileSize: number
  wordWrap: boolean
  onToggleWordWrap: () => void
  content?: string
}

function formatLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
    json: 'JSON', yaml: 'YAML', css: 'CSS', html: 'HTML', python: 'Python',
    ruby: 'Ruby', go: 'Go', rust: 'Rust', bash: 'Bash', toml: 'TOML',
    xml: 'XML', sql: 'SQL', graphql: 'GraphQL', markdown: 'Markdown',
    diff: 'Diff', dockerfile: 'Dockerfile', c: 'C', cpp: 'C++', java: 'Java',
    swift: 'Swift', kotlin: 'Kotlin', php: 'PHP', lua: 'Lua', zig: 'Zig',
    elixir: 'Elixir', haskell: 'Haskell', text: 'Plain Text',
  }
  return map[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)
}

export default function CodeToolbar({ language, lineCount, fileSize, wordWrap, onToggleWordWrap, content }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard not available */ }
  }, [content])

  return (
    <div className="code-toolbar">
      <div className="code-toolbar__left">
        <span className="code-toolbar__lang-badge">{formatLanguage(language)}</span>
        <span className="code-toolbar__meta">{lineCount} lines</span>
        <span className="code-toolbar__divider">·</span>
        <span className="code-toolbar__meta">{formatBytes(fileSize)}</span>
      </div>
      <div className="code-toolbar__right">
        <button
          className="code-toolbar__btn"
          title="Copy file contents"
          onClick={handleCopy}
          disabled={!content}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </button>
        <button
          className={`code-toolbar__btn${wordWrap ? ' code-toolbar__btn--active' : ''}`}
          title="Toggle word wrap"
          onClick={onToggleWordWrap}
        >
          {wordWrap ? <WrapText size={14} /> : <AlignLeft size={14} />}
        </button>
      </div>
    </div>
  )
}

export { formatLanguage }
