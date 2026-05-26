import { useEffect, useRef } from 'react'
import { Search, Filter, Rows3, GitCompare } from 'lucide-react'
import type { SearchMode, Density, DiffBaseRef } from '../../lib/fileTree/types'
import FilterDropdown from './FilterDropdown'
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

const MODE_OPTIONS: { value: SearchMode; label: string }[] = [
  { value: 'expand',   label: 'Expand matches' },
  { value: 'collapse', label: 'Collapse non-matches' },
  { value: 'hide',     label: 'Hide non-matches' },
]

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'compact',     label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious',    label: 'Spacious' },
]

export default function FilesToolbar(props: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onFocus() { searchInputRef.current?.focus() }
    window.addEventListener('files-toolbar:focus-search', onFocus)
    return () => window.removeEventListener('files-toolbar:focus-search', onFocus)
  }, [])

  // Encode the diff base as a single string for FilterDropdown's value contract.
  const diffBaseValue = props.diffBase ? `${props.diffBase.type}:${props.diffBase.ref}` : null
  const diffBaseDropdownOptions = props.diffBaseOptions.map(opt => ({
    value: `${opt.ref.type}:${opt.ref.ref}`,
    label: opt.label,
  }))

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

      <FilterDropdown
        icon={<Filter size={13} />}
        value={props.searchMode}
        options={MODE_OPTIONS}
        onChange={v => v && props.onSearchModeChange(v)}
      />

      <FilterDropdown
        icon={<Rows3 size={13} />}
        value={props.density}
        options={DENSITY_OPTIONS}
        onChange={v => v && props.onDensityChange(v)}
      />

      <FilterDropdown
        icon={<GitCompare size={13} />}
        value={diffBaseValue}
        options={diffBaseDropdownOptions}
        placeholder="Compare"
        allowNone
        onChange={v => {
          if (!v) { props.onDiffBaseChange(null); return }
          const [type, ...rest] = v.split(':')
          props.onDiffBaseChange({ type: type as DiffBaseRef['type'], ref: rest.join(':') })
        }}
      />
    </div>
  )
}
