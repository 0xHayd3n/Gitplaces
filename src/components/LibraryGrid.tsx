import LibraryCard from './LibraryCard'
import LibraryListRow from './LibraryListRow'
import ViewportWindow from './ViewportWindow'
import type { LibrarySavedRepo } from '../types/repo'
import type { LayoutPrefs } from './LayoutDropdown'

export interface LibraryGridProps {
  rows: LibrarySavedRepo[]
  selectedId: string | null
  layoutPrefs: LayoutPrefs
  subSkillIds: Set<string>
  onSelect: (row: LibrarySavedRepo) => void
}

export default function LibraryGrid({
  rows, selectedId, layoutPrefs, subSkillIds, onSelect,
}: LibraryGridProps) {
  const isList = layoutPrefs.mode === 'list'

  return (
    <div
      className={isList ? 'library-list' : 'library-grid'}
      style={!isList ? { gridTemplateColumns: `repeat(${layoutPrefs.columns}, minmax(0, 1fr))` } : undefined}
    >
      {rows.map(row => (
        <ViewportWindow
          key={row.fullName}
          placeholderHeight={isList ? 52 : 220}
        >
          {isList ? (
            <LibraryListRow
              row={row}
              selected={selectedId === row.fullName}
              onSelect={() => onSelect(row)}
            />
          ) : (
            <LibraryCard
              row={row}
              selected={selectedId === row.fullName}
              hasSubSkill={subSkillIds.has(row.fullName)}
              onSelect={() => onSelect(row)}
            />
          )}
        </ViewportWindow>
      ))}
    </div>
  )
}
