import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CollectionDetail from './CollectionDetail'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import { ToastProvider } from '../contexts/Toast'

vi.mock('../components/CollDetail', () => ({
  default: ({ coll }: any) => <div data-testid="coll-detail">{coll?.name}</div>,
}))

const mockColl = {
  id: 'user-1', name: 'My Stack', description: 'Tools',
  owner: 'user', active: 1, created_at: '2026-01-01T00:00:00.000Z',
  color_start: '#3b82f6', color_end: '#6366f1',
  repo_count: 2, saved_count: 2,
}

function wrap(id: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/library/collection/${id}`, state }]}>
      <ProfileOverlayProvider>
        <ToastProvider>
          <Routes>
            <Route path="/library/collection/:id" element={<CollectionDetail />} />
            <Route path="/library" element={<div>library home</div>} />
          </Routes>
        </ToastProvider>
      </ProfileOverlayProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: {
      getAll: vi.fn().mockResolvedValue([mockColl]),
      getDetail: vi.fn().mockResolvedValue([]),
      toggle: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    library: { getAll: vi.fn().mockResolvedValue([]) },
    repo: { save: vi.fn().mockResolvedValue(undefined) },
    skill: { generate: vi.fn().mockResolvedValue({ content: '', version: 'v1', generated_at: '' }) },
  })
})

describe('CollectionDetail', () => {
  it('renders CollDetail with coll from router state', async () => {
    wrap('user-1', { coll: mockColl, collectionName: 'My Stack' })
    expect(await screen.findByTestId('coll-detail')).toHaveTextContent('My Stack')
  })

  it('falls back to fetching coll when state is absent', async () => {
    wrap('user-1') // no state
    expect(await screen.findByTestId('coll-detail')).toHaveTextContent('My Stack')
  })
})
