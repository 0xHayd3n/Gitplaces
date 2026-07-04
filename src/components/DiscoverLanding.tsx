import { useState, useRef, type RefObject } from 'react'
import { useRotatingPlaceholder } from '../hooks/useRotatingPlaceholder'
import logo from '../assets/logo.png'

interface Props {
  query: string
  onQueryChange: (query: string) => void
  onSearch: (query: string) => void
  onBrowse: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  inputRef?: RefObject<HTMLInputElement>
}

export default function DiscoverLanding({ query, onQueryChange, onSearch, onBrowse, onKeyDown, inputRef: externalRef }: Props) {
  const internalRef = useRef<HTMLInputElement>(null)
  const ref = externalRef ?? internalRef
  const [focused, setFocused] = useState(false)
  const placeholder = useRotatingPlaceholder(focused, query.length > 0)

  function handleKeyDown(e: React.KeyboardEvent) {
    onKeyDown?.(e)
    if (e.key === 'Enter' && query.trim()) {
      onSearch(query.trim())
    }
  }

  return (
    <div className="discover-landing">
      <div className="discover-landing-brand">
        <img src={logo} alt="Gitplaces" className="discover-landing-logo" />
        <span className="discover-landing-wordmark">Gitplaces</span>
      </div>

      <div className="discover-landing-search-wrap">
        <svg width="16" height="16" viewBox="0 0 13 13" fill="none" className="discover-landing-search-icon">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
          <line x1="8.6" y1="8.6" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          ref={ref as RefObject<HTMLInputElement>}
          type="text"
          className="discover-landing-search"
          placeholder=""
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {!query && !focused && (
          <span
            className="discover-landing-placeholder"
            style={{ opacity: placeholder.visible ? 1 : 0 }}
          >
            {placeholder.text}
          </span>
        )}
      </div>

      <button className="discover-landing-browse" onClick={onBrowse}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
        Browse
      </button>
    </div>
  )
}
