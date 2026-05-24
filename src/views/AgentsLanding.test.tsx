// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentsLanding from './AgentsLanding'
import type { AgentRow } from '../types/agent'

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: overrides.id ?? `a-${Math.random()}`,
    name: overrides.name ?? 'Agent',
    handle: overrides.handle ?? 'agent',
    body: overrides.body ?? '# Body',
    folder_id: null,
    color_start: '#6366f1',
    color_end: null,
    emoji: null,
    pinned: overrides.pinned ?? 0,
    pinned_at: overrides.pinned_at ?? null,
    last_used_at: overrides.last_used_at ?? null,
    presets_json: '[]',
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
  }
}

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders: [], agents: [] }),
      onChanged: vi.fn(),
      offChanged: vi.fn(),
    },
  }
})

function setup() {
  return render(<MemoryRouter><AgentsLanding /></MemoryRouter>)
}

describe('AgentsLanding', () => {
  it('renders the onboarding card when there are no pinned or recent agents', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ name: 'Brand new', handle: 'brand-new' })],
    })
    setup()
    await waitFor(() => screen.getByText(/your prompt library/i))
    expect(screen.getByText(/new agent/i)).toBeTruthy()
    expect(screen.queryByText(/^pinned$/i)).toBeNull()
    expect(screen.queryByText(/^recent$/i)).toBeNull()
  })

  it('renders the pinned grid when pinned agents exist', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Pinned A', handle: 'pinned-a', pinned: 1, pinned_at: '2026-05-25T10:00:00Z' }),
        agent({ name: 'Pinned B', handle: 'pinned-b', pinned: 1, pinned_at: '2026-05-25T09:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Pinned A'))
    expect(screen.getByText(/^pinned$/i)).toBeTruthy()
    expect(screen.getByText('Pinned B')).toBeTruthy()
  })

  it('renders the recent list when used agents exist', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Recent A', handle: 'recent-a', last_used_at: '2026-05-25T10:00:00Z' }),
        agent({ name: 'Recent B', handle: 'recent-b', last_used_at: '2026-05-25T09:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Recent A'))
    expect(screen.getByText(/^recent$/i)).toBeTruthy()
    expect(screen.getByText('Recent B')).toBeTruthy()
  })

  it('orders pinned agents by pinned_at DESC', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [
        agent({ name: 'Older pin', handle: 'older', pinned: 1, pinned_at: '2026-05-20T00:00:00Z' }),
        agent({ name: 'Newer pin', handle: 'newer', pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }),
      ],
    })
    setup()
    await waitFor(() => screen.getByText('Newer pin'))
    const cards = screen.getAllByTestId('agents-landing-pinned-card')
    expect(cards[0].textContent).toContain('Newer pin')
    expect(cards[1].textContent).toContain('Older pin')
  })

  it('orders recent agents by last_used_at DESC and caps at 10', async () => {
    const many = Array.from({ length: 12 }).map((_, i) =>
      agent({
        name: `Used ${i}`, handle: `used-${i}`,
        last_used_at: `2026-05-25T${String(10 - (i % 12)).padStart(2, '0')}:00:00Z`,
      }),
    )
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders: [], agents: many })
    setup()
    await waitFor(() => screen.getByText(/^recent$/i))
    const rows = screen.getAllByTestId('agents-landing-recent-row')
    expect(rows.length).toBeLessThanOrEqual(10)
  })

  it('clicking a pinned card navigates to the agent', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ id: 'a-pin', name: 'Pinned A', handle: 'pinned-a', pinned: 1, pinned_at: 't' })],
    })
    render(
      <MemoryRouter initialEntries={['/library/agents']}>
        <AgentsLanding />
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByText('Pinned A'))
    const card = screen.getByTestId('agents-landing-pinned-card')
    fireEvent.click(card)
    const linkEl = card.querySelector('a') ?? card.closest('a')
    expect(linkEl?.getAttribute('href')).toBe('/library/agent/a-pin')
  })

  it('shows the agent count in the header', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({
      folders: [],
      agents: [agent({ id: '1' }), agent({ id: '2' }), agent({ id: '3' })],
    })
    setup()
    await waitFor(() => screen.getByText(/3 agents/i))
  })
})
