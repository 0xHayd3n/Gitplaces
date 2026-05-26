import { useEffect, useRef } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import type { SearchMode, Density, DiffBaseRef } from '../../lib/fileTree/types'
import './FilesToolbar.css'

interface DiffBaseOption {
  label: string
  ref: DiffBaseRef
}

interface Props {
  searchValue: string
  onSearchChange: (v: string) => void
  searchMode: SearchMode
  onSearchModeChange: (m: SearchMode) => void
  density: Density
  onDensityChange: (d: Density) => void
  diffBase: DiffBaseRef | null
  onDiffBaseChange: (r: DiffBaseRef | null) => void
  diffBaseOptions: DiffBaseOption[]
}

const MODE_LABEL: Record<SearchMode, string> = {
  expand: 'Expand matches',
  collapse: 'Collapse non-matches',
  hide: 'Hide non-matches',
}

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  spacious: 'Spacious',
}

export default function FilesToolbar(props: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onFocus() { searchInputRef.current?.focus() }
    window.addEventListener('files-toolbar:focus-search', onFocus)
    return () => window.removeEventListener('files-toolbar:focus-search', onFocus)
  }, [])

  return (
    <div className="files-toolbar">
      <div className="files-toolbar__search">
        <Search size={12} className="files-toolbar__search-icon" />
        <input
          ref={searchInputRef}
          className="files-toolbar__search-input"
          type="text"
          placeholder="Search files…"
          value={props.searchValue}
          onChange={e => props.onSearchChange(e.target.value)}
        />
      </div>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Mode</span>
        <select value={props.searchMode} onChange={e => props.onSearchModeChange(e.target.value as SearchMode)}>
          {(Object.keys(MODE_LABEL) as SearchMode[]).map(m => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Density</span>
        <select value={props.density} onChange={e => props.onDensityChange(e.target.value as Density)}>
          {(Object.keys(DENSITY_LABEL) as Density[]).map(d => (
            <option key={d} value={d}>{DENSITY_LABEL[d]}</option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>

      <label className="files-toolbar__select">
        <span className="files-toolbar__select-label">Compare</span>
        <select
          value={props.diffBase ? `${props.diffBase.type}:${props.diffBase.ref}` : ''}
          onChange={e => {
            if (!e.target.value) { props.onDiffBaseChange(null); return }
            const [type, ...rest] = e.target.value.split(':')
            props.onDiffBaseChange({ type: type as DiffBaseRef['type'], ref: rest.join(':') })
          }}
        >
          <option value="">None</option>
          {props.diffBaseOptions.map(opt => (
            <option key={`${opt.ref.type}:${opt.ref.ref}`} value={`${opt.ref.type}:${opt.ref.ref}`}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={10} />
      </label>
    </div>
  )
}
