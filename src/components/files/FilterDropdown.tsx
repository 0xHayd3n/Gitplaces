import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import './FilterDropdown.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  icon: React.ReactNode
  value: T | null
  options: Option<T>[]
  placeholder?: string
  onChange: (v: T | null) => void
  /** When true, a "None" option is rendered at the top that emits null. */
  allowNone?: boolean
  noneLabel?: string
}

export default function FilterDropdown<T extends string>({
  icon, value, options, placeholder, onChange, allowNone, noneLabel = 'None',
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentLabel = value == null
    ? (placeholder ?? noneLabel)
    : (options.find(o => o.value === value)?.label ?? value)

  return (
    <div ref={rootRef} className="filter-dd">
      <button
        type="button"
        className={'filter-dd__trigger' + (open ? ' filter-dd__trigger--open' : '')}
        onClick={() => setOpen(o => !o)}
      >
        <span className="filter-dd__icon">{icon}</span>
        <span className="filter-dd__value">{currentLabel}</span>
        <ChevronDown size={12} className="filter-dd__chev" />
      </button>
      {open && (
        <div className="filter-dd__menu" role="listbox">
          {allowNone && (
            <button
              type="button"
              role="option"
              aria-selected={value == null}
              className={'filter-dd__option' + (value == null ? ' filter-dd__option--selected' : '')}
              onClick={() => { onChange(null); setOpen(false) }}
            >
              {noneLabel}
            </button>
          )}
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={'filter-dd__option' + (o.value === value ? ' filter-dd__option--selected' : '')}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
