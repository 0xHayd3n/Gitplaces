import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  actionLabel: string
  onAction: () => void
  actionIcon?: ReactNode
  disabled?: boolean
  variant?: 'primary' | 'idle' | 'learned'
  className?: string
  children: ReactNode // dropdown menu items
}

// Menu renders into document.body via portal to escape any ancestor stacking
// context. The article layout pins tabs at z-index 10 inside a z-index:1
// wrapper, which would otherwise trap an in-flow dropdown below the tabs no
// matter what z-index it had.
export function PrimaryActionSplitButton({
  actionLabel, onAction, actionIcon, disabled, variant = 'primary', className = '', children,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  // Position the portaled menu under the right edge of the wrapper.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const update = () => {
      const rect = wrapRef.current!.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open])

  // Click-outside: account for both the wrapper and the portaled menu.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    // Close on outside scroll — keeps the menu anchored to its trigger.
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onClick)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('scroll', onScroll, true)
    }
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
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="split-button-menu"
          role="menu"
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}
