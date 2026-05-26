import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DirectoryPane from './DirectoryPane'
import type { TreeEntry } from '../../lib/fileTree/types'

const dir = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const file = (path: string, sha: string): TreeEntry => ({ path, mode: '100644', type: 'blob', sha, size: 100 })

const baseProps = {
  density: 'comfortable' as const,
  selected: new Set<string>(),
  getLastCommit: () => undefined,
  getGitStatus: () => undefined,
  owner: 'o',
  name: 'n',
  width: 400,
  onRowClick: vi.fn(),
  onRowContextMenu: vi.fn(),
}

describe('DirectoryPane', () => {
  it('renders empty state when entries is empty', () => {
    render(<DirectoryPane {...baseProps} entries={[]} basePath="" />)
    expect(screen.getByText('This folder is empty')).toBeInTheDocument()
  })

  it('renders each entry as a row', () => {
    render(<DirectoryPane {...baseProps}
      entries={[file('README.md', 'r-sha'), file('LICENSE', 'l-sha')]}
      basePath="" />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('LICENSE')).toBeInTheDocument()
  })

  it('sorts directories before files', () => {
    const { container } = render(<DirectoryPane {...baseProps}
      entries={[file('zfile.md', 'z-sha'), dir('adir', 'a-sha')]}
      basePath="" />)
    const rows = container.querySelectorAll('.file-row')
    expect(rows[0].textContent).toContain('adir')
    expect(rows[1].textContent).toContain('zfile.md')
  })
})
