import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Collections from './Collections'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { SearchProvider } from '../contexts/Search'
import { ToastProvider } from '../contexts/Toast'

const mockCollections = [
  {
    id: 'user-1', name: 'My Stack', description: 'Tools I use',
    owner: 'user', active: 1, created_at: '2026-01-01T00:00:00.000Z',
    color_start: '#3b82f6', color_end: '#6366f1',
    repo_count: 2, saved_count: 2,
  },
  {
    id: 'community-python-api', name: 'Python API Stack',
    description: 'FastAPI and friends', owner: 'git-suite',
    active: 1, created_at: '2026-01-01T00:00:00.000Z',
    color_start: '#3b82f6', color_end: '#6366f1',
    repo_count: 5, saved_count: 2,
  },
]

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: {
      getAll: vi.fn().mockResolvedValue(mockCollections),
      getDetail: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue('new-id'),
      delete: vi.fn().mockResolvedValue(undefined),
      toggle: vi.fn().mockResolvedValue(undefined),
    },
    library: { getAll: vi.fn().mockResolvedValue([]) },
    settings: { getApiKey: vi.fn().mockResolvedValue('key') },
    skill: { generate: vi.fn().mockResolvedValue({ content: '', version: 'v1', generated_at: '' }), detectClaudeCode: vi.fn().mockResolvedValue(false) },
    repo: { save: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('Collections', () => {
  it('renders the topbar with new collection button', async () => {
    render(<MemoryRouter><ProfileOverlayProvider><SearchProvider><ToastProvider><Collections /></ToastProvider></SearchProvider></ProfileOverlayProvider></MemoryRouter>)
    expect(await screen.findByText('+ New collection')).toBeInTheDocument()
  })

  it('renders Mine and Community section labels', async () => {
    render(<MemoryRouter><ProfileOverlayProvider><SearchProvider><ToastProvider><Collections /></ToastProvider></SearchProvider></ProfileOverlayProvider></MemoryRouter>)
    expect(await screen.findByText('Mine')).toBeInTheDocument()
    expect(await screen.findByText('Community')).toBeInTheDocument()
  })

  it('renders collection names', async () => {
    render(<MemoryRouter><ProfileOverlayProvider><SearchProvider><ToastProvider><Collections /></ToastProvider></SearchProvider></ProfileOverlayProvider></MemoryRouter>)
    expect((await screen.findAllByText('My Stack')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Python API Stack')).toBeInTheDocument()
  })
})
