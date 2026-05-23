import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LibrarySidebar from './LibrarySidebar'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'
import { ToastProvider } from '../contexts/Toast'

function LocationDisplay() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

function wrap(ui: React.ReactElement, initialPath = '/library/repo/foo/bar') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MockLearningProgressProvider>
        <ToastProvider>
          <Routes>
            <Route path="*" element={<>{ui}<LocationDisplay /></>} />
          </Routes>
        </ToastProvider>
      </MockLearningProgressProvider>
    </MemoryRouter>
  )
}

const defaultProps = {
  installedRows: [],
  starredRows: [],
  unstarredRows: [],
  localProjects: [],
  archivedSet: new Set<string>(),
  selectedId: null,
  selectedLocalPath: null,
  onSelect: vi.fn(),
  onSelectLocal: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', {
    collection: { getAll: vi.fn().mockResolvedValue([]) },
  })
})

describe('LibrarySidebar — top bar', () => {
  it('renders a home button that navigates to /library', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    const homeBtn = screen.getByRole('button', { name: /home/i })
    expect(homeBtn).toBeInTheDocument()
    fireEvent.click(homeBtn)
    expect(screen.getByTestId('loc').textContent).toBe('/library')
  })

  it('renders a Repos/Collections toggle with Repos active by default', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    const reposBtn = screen.getByRole('button', { name: 'Repositories' })
    const collsBtn = screen.getByRole('button', { name: 'Collections' })
    expect(reposBtn).toHaveClass('active')
    expect(collsBtn).not.toHaveClass('active')
  })

  it('clicking Collections toggle activates it', () => {
    wrap(<LibrarySidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    expect(screen.getByRole('button', { name: 'Collections' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Repositories' })).not.toHaveClass('active')
  })
})
