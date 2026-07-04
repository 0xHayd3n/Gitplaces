import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CollectionsSidebar from './CollectionsSidebar'
import { ToastProvider } from '../contexts/Toast'

const mockCollections = [
  {
    id: 'user-1', name: 'My Stack', description: 'Tools I use',
    owner: 'user', active: 1, created_at: '2026-01-01T00:00:00.000Z',
    color_start: '#3b82f6', color_end: '#6366f1',
    repo_count: 2, saved_count: 2,
  },
  {
    id: 'community-1', name: 'Python API', description: 'FastAPI etc',
    owner: 'gitplaces', active: 1, created_at: '2026-01-01T00:00:00.000Z',
    color_start: '#10b981', color_end: '#059669',
    repo_count: 5, saved_count: 3,
  },
]

function wrap(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: {
      getAll: vi.fn().mockResolvedValue(mockCollections),
      create: vi.fn().mockResolvedValue('new-id'),
    },
    library: { getAll: vi.fn().mockResolvedValue([]) },
  })
})

describe('CollectionsSidebar', () => {
  it('renders collection names after load', async () => {
    const onSelect = vi.fn()
    wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} />)
    expect(await screen.findByText('My Stack')).toBeInTheDocument()
    expect(screen.getByText('Python API')).toBeInTheDocument()
  })

  it('highlights the selected collection', async () => {
    const onSelect = vi.fn()
    wrap(<CollectionsSidebar selectedId="user-1" onSelect={onSelect} />)
    await screen.findByText('My Stack')
    const item = screen.getByText('My Stack').closest('[data-collection-id]')
    expect(item).toHaveClass('selected')
  })

  it('calls onSelect with collection id when a row is clicked', async () => {
    const onSelect = vi.fn()
    wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} />)
    await screen.findByText('Python API')
    fireEvent.click(screen.getByText('Python API'))
    expect(onSelect).toHaveBeenCalledWith('community-1', expect.any(Object))
  })

  it('shows a New collection button', async () => {
    wrap(<CollectionsSidebar selectedId={null} onSelect={vi.fn()} />)
    await screen.findByText('My Stack')
    expect(screen.getByText(/new collection/i)).toBeInTheDocument()
  })

  it('filters collections by name when searchTerm is set', async () => {
    const onSelect = vi.fn()
    wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} searchTerm="python" />)
    expect(await screen.findByText('Python API')).toBeInTheDocument()
    expect(screen.queryByText('My Stack')).not.toBeInTheDocument()
  })

  it('is case-insensitive', async () => {
    const onSelect = vi.fn()
    wrap(<CollectionsSidebar selectedId={null} onSelect={onSelect} searchTerm="STACK" />)
    expect(await screen.findByText('My Stack')).toBeInTheDocument()
  })

  it('no longer renders a COLLECTIONS header', async () => {
    wrap(<CollectionsSidebar selectedId={null} onSelect={vi.fn()} />)
    await screen.findByText('My Stack')
    expect(screen.queryByText(/^COLLECTIONS$/i)).not.toBeInTheDocument()
  })
})
