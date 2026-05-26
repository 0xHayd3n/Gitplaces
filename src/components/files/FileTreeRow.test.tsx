import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileTreeRow from './FileTreeRow'
import type { VisibleRow } from '../../lib/fileTree/types'

const baseRow: VisibleRow = {
  path: 'src/Button.tsx',
  type: 'blob',
  name: 'Button.tsx',
  depth: 1,
  sha: 'btn-sha',
  size: 2400,
  isExpanded: false,
  isFlattened: false,
  level: 2,
  posInSet: 1,
  setSize: 1,
}

const baseProps = {
  density: 'comfortable' as const,
  isFocused: false,
  isSelected: false,
  lastCommit: undefined,
  gitStatus: undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onClick: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('FileTreeRow', () => {
  it('renders the file name', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} />)
    expect(screen.getByText('Button.tsx')).toBeInTheDocument()
  })

  it('shows file size when present', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} />)
    expect(screen.getByText('2.3 KB')).toBeInTheDocument()
  })

  it('renders last commit message when present and width >= 280', () => {
    render(<FileTreeRow {...baseProps} row={baseRow}
      lastCommit={{ message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: new Date().toISOString(), commit_sha: 'abc' }} />)
    expect(screen.getByText('fix bug')).toBeInTheDocument()
  })

  it('hides last commit message at narrow widths', () => {
    render(<FileTreeRow {...baseProps} row={baseRow} width={200}
      lastCommit={{ message: 'fix bug', author_login: 'alice', author_avatar: null, committed_at: new Date().toISOString(), commit_sha: 'abc' }} />)
    expect(screen.queryByText('fix bug')).not.toBeInTheDocument()
  })

  it('shows status dot when gitStatus present', () => {
    const { container } = render(<FileTreeRow {...baseProps} row={baseRow} gitStatus="modified" />)
    expect(container.querySelector('.file-row__status-dot')).toBeInTheDocument()
  })

  it('renders per-segment buttons for flattened rows', () => {
    const onSegmentClick = vi.fn()
    const flattenedRow: VisibleRow = {
      ...baseRow,
      path: 'a/b/c',
      type: 'tree',
      name: 'a/b/c',
      flattenedSegments: ['a', 'b', 'c'],
      isFlattened: true,
    }
    render(<FileTreeRow {...baseProps} row={flattenedRow} onSegmentClick={onSegmentClick} />)
    const segB = screen.getByRole('button', { name: 'b' })
    fireEvent.click(segB)
    expect(onSegmentClick).toHaveBeenCalledWith(1)
  })

  it('highlights match ranges in the name', () => {
    const row = { ...baseRow, matchRanges: [[0, 6] as [number, number]] }
    const { container } = render(<FileTreeRow {...baseProps} row={row} />)
    const mark = container.querySelector('mark.file-row__match')
    expect(mark?.textContent).toBe('Button')
  })

  it('expanded directories get aria-expanded=true', () => {
    const row = { ...baseRow, type: 'tree' as const, isExpanded: true }
    render(<FileTreeRow {...baseProps} row={row} />)
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-expanded', 'true')
  })
})
