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
  description: '',
  origin_plugin: null,
  origin_path: null,
  origin_version: null,
  origin_imported_at: null,
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

  it('selecting an emoji calls api.agents.update with the new emoji', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    // Open the AgentEmojiPicker's own popover
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    // Pick the first emoji cell in the grid
    const cells = document.querySelectorAll('.agent-emoji-cell')
    expect(cells.length).toBeGreaterThan(0)
    fireEvent.click(cells[0] as HTMLButtonElement)
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalled())
    const call = (window.api.agents.update as any).mock.calls.find(
      (c: any[]) => 'emoji' in c[1],
    )
    expect(call).toBeTruthy()
    expect(call[0]).toBe('a1')
    expect(call[1].emoji).toBeTruthy()
  })

  it('color picker hex change calls api.agents.update with colorStart', async () => {
    render(<AgentSwatchPopover agent={agent} />)
    fireEvent.click(screen.getByRole('button', { name: /edit appearance/i }))
    const startHex = screen.getByLabelText('Start hex') as HTMLInputElement
    fireEvent.change(startHex, { target: { value: '#ff0000' } })
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalled())
    const call = (window.api.agents.update as any).mock.calls.find(
      (c: any[]) => 'colorStart' in c[1],
    )
    expect(call).toBeTruthy()
    expect(call[1].colorStart).toBe('#ff0000')
  })
})
