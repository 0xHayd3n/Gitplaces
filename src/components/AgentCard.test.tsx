import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AgentCard from './AgentCard'
import type { AgentRow } from '../types/agent'

function mkAgent(partial: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1', name: 'Brainstorm', handle: 'brainstorm', folder_id: null,
    color_start: '#6366f1', color_end: '#a855f7', emoji: '🧠',
    pinned: 0, pinned_at: null, last_used_at: null,
    presets_json: '[]', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', description: 'Turn ideas into specs.',
    origin_plugin: null, origin_path: null, origin_version: null,
    origin_imported_at: null, tools: null, model: 'inherit',
    model_provider: 'anthropic', model_endpoint_id: null,
    is_subagent: 0, is_slash_command: 0, argument_hint: null,
    synced_subagent_at: null, synced_slash_command_at: null,
    ...partial,
  }
}

function renderCard(agent: AgentRow) {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<AgentCard agent={agent} />} />
        <Route path="/library/agent/:id" element={<div>agent detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AgentCard', () => {
  it('renders name, handle, description and emoji', () => {
    renderCard(mkAgent())
    expect(screen.getByText('Brainstorm')).toBeTruthy()
    expect(screen.getByText('@brainstorm')).toBeTruthy()
    expect(screen.getByText('Turn ideas into specs.')).toBeTruthy()
    expect(screen.getByText('🧠')).toBeTruthy()
  })

  it('renders Subagent and Slash Command pills when flags are set', () => {
    renderCard(mkAgent({ is_subagent: 1, is_slash_command: 1 }))
    expect(screen.getByText('Subagent')).toBeTruthy()
    expect(screen.getByText('Slash Command')).toBeTruthy()
  })

  it('omits pills when flags are 0', () => {
    renderCard(mkAgent({ is_subagent: 0, is_slash_command: 0 }))
    expect(screen.queryByText('Subagent')).toBeNull()
    expect(screen.queryByText('Slash Command')).toBeNull()
  })

  it('applies the gradient swatch when color_end is set', () => {
    renderCard(mkAgent({ color_start: '#6366f1', color_end: '#a855f7' }))
    const swatch = screen.getByTestId('agent-card-swatch')
    expect((swatch as HTMLElement).style.background).toContain('linear-gradient')
  })

  it('falls back to solid swatch when color_end is null', () => {
    renderCard(mkAgent({ color_start: '#6366f1', color_end: null }))
    const swatch = screen.getByTestId('agent-card-swatch')
    expect((swatch as HTMLElement).style.background).not.toContain('linear-gradient')
  })

  it('navigates to /library/agent/:id on click', () => {
    renderCard(mkAgent({ id: 'xyz' }))
    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/i }))
    expect(screen.getByText('agent detail')).toBeTruthy()
  })
})
