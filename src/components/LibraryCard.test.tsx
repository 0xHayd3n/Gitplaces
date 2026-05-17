import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import LibraryCard from './LibraryCard'
import type { LibraryRow } from '../types/repo'

const mockRow: LibraryRow = {
  id: 'r1', owner: 'facebook', name: 'react', language: 'TypeScript',
  description: 'A JS library',
  topics: '[]', stars: null, forks: null, license: 'MIT',
  homepage: null, updated_at: null, pushed_at: null, saved_at: '2026-01-01',
  type: 'skill', banner_svg: null, discovered_at: null, discover_query: null,
  watchers: null, size: null, open_issues: null, starred_at: null,
  default_branch: null, avatar_url: null, og_image_url: null, banner_color: null,
  translated_description: null, translated_description_lang: null,
  translated_readme: null, translated_readme_lang: null, detected_language: null,
  verification_score: null, verification_tier: null, verification_signals: null, verification_checked_at: null,
  type_bucket: 'frameworks', type_sub: 'web-framework',
  active: 1, version: 'v18.0.0', generated_at: '2026-01-01T00:00:00.000Z',
  enabled_components: null, enabled_tools: null, tier: 1, installed: 1,
  unstarred_at: null, is_forked: null, update_available: null,
  update_checked_at: null, upstream_version: null, stored_version: null,
}

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
