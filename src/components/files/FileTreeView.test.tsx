import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import FileTreeView from './FileTreeView'
import type { VisibleRow } from '../../lib/fileTree/types'

const mkRow = (path: string, depth: number, type: 'tree' | 'blob' = 'blob', isExpanded = false): VisibleRow => ({
  path, type, name: path.split('/').pop()!, depth, sha: path + '-sha',
  isExpanded, isFlattened: false,
  level: depth + 1, posInSet: 1, setSize: 1,
})

const baseProps = {
  density: 'comfortable' as const,
  focused: null,
  selected: new Set<string>(),
  getLastCommit: () => undefined,
  getGitStatus: () => undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onRowClick: vi.fn(),
  onRowContextMenu: vi.fn(),
  onSegmentClick: vi.fn(),
  onKeyDown: vi.fn(),
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}; unobserve() {}; disconnect() {}
    }
  }
})

describe('FileTreeView', () => {
  it('renders the role=tree container', () => {
    const { container } = render(<FileTreeView {...baseProps} rows={[mkRow('a', 0)]} />)
    expect(container.querySelector('[role="tree"]')).toBeInTheDocument()
  })

  it('renders rows from the virtualizer', () => {
    const rows = [mkRow('a', 0), mkRow('b', 0), mkRow('c', 0)]
    const { container } = render(<FileTreeView {...baseProps} rows={rows} />)
    expect(container.querySelectorAll('.file-row').length).toBeGreaterThan(0)
  })

  it('renders empty when rows is empty', () => {
    const { container } = render(<FileTreeView {...baseProps} rows={[]} />)
    expect(container.querySelectorAll('.file-row').length).toBe(0)
  })
})
