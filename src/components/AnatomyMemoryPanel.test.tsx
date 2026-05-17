import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyMemoryPanel from './AnatomyMemoryPanel'
import type { AnatomyMemoryEntryView } from '../types/repo'

const entries: AnatomyMemoryEntryView[] = [
  { text: 'older note', kind: 'gotcha', at: '2026-05-10T00:00:00Z' },
  { text: 'newest note', kind: 'convention', at: '2026-05-16T00:00:00Z' },
  { text: 'superseded note', kind: 'attempt', at: '2026-05-01T00:00:00Z', superseded: true },
]

describe('AnatomyMemoryPanel', () => {
  it('renders entries newest-first', () => {
    render(<AnatomyMemoryPanel entries={entries} />)
    const items = screen.getAllByTestId('anatomy-mem-entry')
    expect(items[0]).toHaveTextContent('newest note')
    expect(items[1]).toHaveTextContent('older note')
  })

  it('hides superseded entries behind a toggle', () => {
    render(<AnatomyMemoryPanel entries={entries} />)
    expect(screen.queryByText('superseded note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /superseded/i }))
    expect(screen.getByText('superseded note')).toBeInTheDocument()
  })

  it('renders nothing when there are no entries', () => {
    const { container } = render(<AnatomyMemoryPanel entries={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
