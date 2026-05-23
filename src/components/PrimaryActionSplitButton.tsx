import { useState, useRef, useEffect, type ReactNode } from 'react'

interface Props {
  actionLabel: string
  onAction: () => void
  actionIcon?: ReactNode
  disabled?: boolean
  variant?: 'primary' | 'idle' | 'learned'
  className?: string
  children: ReactNode // dropdown menu items
}

export function PrimaryActionSplitButton({
  actionLabel, onAction, actionIcon, disabled, variant = 'primary', className = '', children,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={wrapRef} className={`split-button split-button--${variant} ${className}`}>
      <button
        type="button"
        className="split-button-action"
        onClick={onAction}
        disabled={disabled}
      >
        {actionIcon}
        <span>{actionLabel}</span>
      </button>
      <button
        type="button"
        className="split-button-caret"
        onClick={() => setOpen(o => !o)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="split-button-menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
