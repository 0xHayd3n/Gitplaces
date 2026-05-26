import { useState, type ReactNode } from 'react'

export type SectionBlockProps = {
  title: string
  count?: number
  badge?: 'BETA'
  defaultExpanded?: boolean
  children: ReactNode
}

export default function SectionBlock({
  title,
  count,
  badge,
  defaultExpanded = true,
  children,
}: SectionBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="section-block">
      <button
        type="button"
        className="section-block-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className="section-block-title-row">
          <span className="section-block-title">{title}</span>
          {count !== undefined && (
            <span className="section-block-count">{count}</span>
          )}
          {badge === 'BETA' && (
            <span className="transport-chip beta">BETA</span>
          )}
        </div>
        <span className={`section-block-chevron${expanded ? ' expanded' : ''}`}>▸</span>
      </button>
      {expanded && (
        <div className="section-block-body">{children}</div>
      )}
    </div>
  )
}
