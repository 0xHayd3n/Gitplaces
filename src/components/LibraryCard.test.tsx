import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import LibraryCard from './LibraryCard'
import type { LibrarySavedRepo } from '../types/repo'
import { fixtureLibrarySavedRepo } from '../test-utils/repoFixtures'

const mockRow: LibrarySavedRepo = fixtureLibrarySavedRepo({
  hostNativeId: 'r1',
  fullName: 'facebook/react',
  owner: 'facebook',
  name: 'react',
  language: 'TypeScript',
  description: 'A JS library',
  license: 'MIT',
  savedAt: '2026-01-01',
  type: 'skill',
  typeBucket: 'frameworks',
  typeSub: 'web-framework',
  version: 'v18.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
})

function renderCard(props: Partial<React.ComponentProps<typeof LibraryCard>> = {}) {
  const defaults = {
    row: mockRow,
    selected: false,
    hasSubSkill: false,
    onSelect: () => {},
  }
  return render(
    <MemoryRouter>
      <ProfileOverlayProvider>
        <LibraryCard {...defaults} {...props} />
      </ProfileOverlayProvider>
    </MemoryRouter>
  )
}

describe('LibraryCard', () => {
  it('renders name and owner', () => {
    renderCard()
    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.getByText('facebook')).toBeInTheDocument()
  })

  it('renders sub-skill indicator when hasSubSkill=true', () => {
    const { container } = renderCard({ hasSubSkill: true })
    expect(container.querySelector('.library-sub-skill-indicator')).toBeInTheDocument()
  })

  it('omits sub-skill indicator when hasSubSkill=false', () => {
    const { container } = renderCard({ hasSubSkill: false })
    expect(container.querySelector('.library-sub-skill-indicator')).not.toBeInTheDocument()
  })

  it('invokes onSelect on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderCard({ onSelect })
    await user.click(screen.getByText('react'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('applies selected class when selected=true', () => {
    const { container } = renderCard({ selected: true })
    expect(container.querySelector('.library-card')).toHaveClass('selected')
  })
})
