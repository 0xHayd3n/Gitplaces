import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoUserEventRow } from './RepoUserEventRow'
import type { RepoUserEvent } from '../types/repoUserEvents'

const baseProps = {
  repoOwner: 'vercel',
  repoName: 'next.js',
  userLogin: 'hayden',
  userAvatarUrl: 'https://avatars.githubusercontent.com/hayden?s=64',
}

describe('RepoUserEventRow', () => {
  it('renders a star event with user login, "starred", and repo chip', () => {
    const event: RepoUserEvent = { type: 'star', ts: '2026-04-01T00:00:00Z' }
    const { container } = render(<RepoUserEventRow event={event} {...baseProps} />)
    expect(screen.getByText('hayden')).toBeInTheDocument()
    expect(screen.getByText('starred')).toBeInTheDocument()
    expect(screen.getByText('vercel/next.js')).toBeInTheDocument()
    expect(container.querySelector('.repo-user-event__chip--repo')).not.toBeNull()
  })

  it('renders an archive event with "archived" verb and repo chip', () => {
    const event: RepoUserEvent = { type: 'archive', ts: '2026-04-02T00:00:00Z' }
    render(<RepoUserEventRow event={event} {...baseProps} />)
    expect(screen.getByText('archived')).toBeInTheDocument()
    expect(screen.getByText('vercel/next.js')).toBeInTheDocument()
  })

  it('renders a fork event with "forked this to" verb and {userLogin}/{repoName} chip', () => {
    const event: RepoUserEvent = { type: 'fork', ts: '2026-04-03T00:00:00Z' }
    render(<RepoUserEventRow event={event} {...baseProps} />)
    expect(screen.getByText('forked this to')).toBeInTheDocument()
    expect(screen.getByText('hayden/next.js')).toBeInTheDocument()
  })

  it('renders a learn (master) event with "learned" verb and skill chip', () => {
    const event: RepoUserEvent = {
      type: 'learn', ts: '2026-04-04T00:00:00Z',
      skillFilename: 'next.js.skill.md', skillType: 'master',
    }
    const { container } = render(<RepoUserEventRow event={event} {...baseProps} />)
    expect(screen.getByText('learned')).toBeInTheDocument()
    expect(screen.getByText('next.js.skill.md')).toBeInTheDocument()
    expect(container.querySelector('.repo-user-event__chip--skill')).not.toBeNull()
  })

  it('renders a learn (components) event with "learned components for" verb', () => {
    const event: RepoUserEvent = {
      type: 'learn', ts: '2026-04-05T00:00:00Z',
      skillFilename: 'next.js.components.skill.md', skillType: 'components',
    }
    render(<RepoUserEventRow event={event} {...baseProps} />)
    expect(screen.getByText('learned components for')).toBeInTheDocument()
    expect(screen.getByText('next.js.components.skill.md')).toBeInTheDocument()
  })
})
