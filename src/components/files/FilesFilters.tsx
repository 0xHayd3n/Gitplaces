import {
  Filter, Rows3, GitCompare,
  UnfoldVertical, FoldVertical, EyeOff,
  Rows4, Rows2,
  CircleSlash, Tag, GitBranch, GitCommit,
} from 'lucide-react'
import FilterDropdown from './FilterDropdown'
import type { SearchMode, Density, DiffBaseRef } from '../../lib/fileTree/types'
import './FilesFilters.css'

interface DiffBaseOption {
  label: string
  ref: DiffBaseRef
}

interface Props {
  searchMode: SearchMode
  onSearchModeChange: (m: SearchMode) => void
  density: Density
  onDensityChange: (d: Density) => void
  diffBase: DiffBaseRef | null
  onDiffBaseChange: (r: DiffBaseRef | null) => void
  diffBaseOptions: DiffBaseOption[]
}

const MODE_OPTIONS: { value: SearchMode; label: string; icon: React.ReactNode }[] = [
  { value: 'expand',   label: 'Expand',   icon: <UnfoldVertical size={13} /> },
  { value: 'collapse', label: 'Collapse', icon: <FoldVertical size={13} /> },
  { value: 'hide',     label: 'Hide',     icon: <EyeOff size={13} /> },
]

const DENSITY_OPTIONS: { value: Density; label: string; icon: React.ReactNode }[] = [
  { value: 'compact',     label: 'Compact',     icon: <Rows4 size={13} /> },
  { value: 'comfortable', label: 'Comfortable', icon: <Rows3 size={13} /> },
  { value: 'spacious',    label: 'Spacious',    icon: <Rows2 size={13} /> },
]

function iconForDiffType(type: DiffBaseRef['type']): React.ReactNode {
  if (type === 'tag')    return <Tag size={13} />
  if (type === 'branch') return <GitBranch size={13} />
  return <GitCommit size={13} />
}

export default function FilesFilters(props: Props) {
  const diffBaseValue = props.diffBase ? `${props.diffBase.type}:${props.diffBase.ref}` : null
  const diffBaseDropdownOptions = props.diffBaseOptions.map(opt => ({
    value: `${opt.ref.type}:${opt.ref.ref}`,
    label: opt.label,
    icon: iconForDiffType(opt.ref.type),
  }))

  return (
    <div className="files-filters">
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
        noneIcon={<CircleSlash size={13} />}
        onChange={v => {
          if (!v) { props.onDiffBaseChange(null); return }
          const [type, ...rest] = v.split(':')
          props.onDiffBaseChange({ type: type as DiffBaseRef['type'], ref: rest.join(':') })
        }}
      />
    </div>
  )
}
