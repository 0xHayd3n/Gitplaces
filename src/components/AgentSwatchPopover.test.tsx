// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentSwatchPopover from './AgentSwatchPopover'
import type { AgentRow } from '../types/agent'

const agent: AgentRow = {
  id: 'a1',
  name: 'Copy editor',
  handle: 'copy-editor',
  body: '',
  folder_id: null,
  color_start: '#10b981',
  color_end: null,
  emoji: '✏️',
  pinned: 0,
  pinned_at: null,
  last_used_at: null,
  presets_json: '[]',
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
}

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      update: vi.fn().mockResolvedValue(undefined),
    },
  }
})

describe('AgentSwatchPopover', () => {
  it('renders the swatch as a button with the agent emoji and solid color', () => {
    render(<AgentSwatchPopover agent={agent} />)
    const btn = screen.getByRole('button', { name: /edit appearance/i })
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('✏️')
    expect(btn.style.background).toBe('rgb(16, 185, 129)')
  })

  it('clicking the swatch opens the popover; outside click closes it', async () => {
    render(
      <div>
        <AgentSwatchPopover agent={agent} />
        <button>outside</button>
      </div>
    )
    expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    expect(screen.getByRole('button', { name: /emoji/i })).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('outside'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull())
  })

  it('Escape key closes the popover', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    expect(screen.getByRole('button', { name: /emoji/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: /emoji/i })).toBeNull())
  })
})
