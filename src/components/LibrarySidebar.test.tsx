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
})
