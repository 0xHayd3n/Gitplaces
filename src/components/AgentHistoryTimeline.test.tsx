// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AgentHistoryTimeline from './AgentHistoryTimeline'
import type { AgentRevision } from '../types/agent'

function rev(overrides: Partial<AgentRevision> = {}): AgentRevision {
  return {
    id: overrides.id ?? `r-${Math.random()}`,
    agent_id: 'a1',
    body: overrides.body ?? 'b',
    presets: overrides.presets ?? [],
    summary: overrides.summary ?? 'something',
    kind: overrides.kind ?? 'body_edit',
    created_at: overrides.created_at ?? new Date().toISOString(),
  }
}

beforeEach(() => {
  // Lock "now" so the "Today" / "Yesterday" grouping is predictable.
  vi.setSystemTime(new Date('2026-05-25T18:00:00Z'))
})

describe('AgentHistoryTimeline', () => {
  it('renders an empty placeholder when there are no revisions', () => {
    render(<AgentHistoryTimeline revisions={[]} onRestore={() => {}} />)
    expect(screen.getByText(/no history/i)).toBeTruthy()
  })

  it('renders one row per revision with the summary text', () => {
    const revisions = [
      rev({ summary: 'Edited body', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ summary: 'Created agent', kind: 'create', created_at: '2026-05-25T16:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    expect(screen.getByText('Edited body')).toBeTruthy()
    expect(screen.getByText('Created agent')).toBeTruthy()
  })

  it('groups revisions by day with DateDivider labels', () => {
    const revisions = [
      rev({ summary: 'today A', created_at: '2026-05-25T17:00:00Z' }),
      rev({ summary: 'today B', created_at: '2026-05-25T10:00:00Z' }),
      rev({ summary: 'yesterday A', created_at: '2026-05-24T20:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    expect(screen.getByText(/^today$/i)).toBeTruthy()
    expect(screen.getByText(/^yesterday$/i)).toBeTruthy()
  })

  it('shows kind-colored dots — body_edit uses the accent class', () => {
    const revisions = [rev({ kind: 'body_edit', summary: 'edit' })]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('edit').closest('.agent-history-row') as HTMLElement
    expect(row.querySelector('.agent-history-dot--body_edit')).toBeTruthy()
  })

  it('clicking Restore on a non-current revision calls onRestore with the revision id', () => {
    const onRestore = vi.fn()
    const revisions = [
      rev({ id: 'r-current', summary: 'current', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', summary: 'old', kind: 'body_edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={onRestore} />)
    const oldRow = screen.getByText('old').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(oldRow).getByRole('button', { name: /restore/i }))
    expect(onRestore).toHaveBeenCalledWith('r-old')
  })

  it('does NOT show Restore on the most-recent revision (the "current" state)', () => {
    const revisions = [
      rev({ id: 'r-current', summary: 'current', kind: 'body_edit', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', summary: 'old', kind: 'body_edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const currentRow = screen.getByText('current').closest('.agent-history-row') as HTMLElement
    expect(within(currentRow).queryByRole('button', { name: /restore/i })).toBeNull()
  })

  it('clicking Diff on a body_edit reveals a two-pane diff viewer', () => {
    const revisions = [
      rev({ id: 'r-new', body: 'line one\nline two changed', kind: 'body_edit', summary: 'edit B', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', body: 'line one\nline two', kind: 'body_edit', summary: 'edit A', created_at: '2026-05-25T16:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const newRow = screen.getByText('edit B').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(newRow).getByRole('button', { name: /diff/i }))
    // The diff panel is rendered inside the timeline; both bodies are visible.
    expect(screen.getByText(/line two$/)).toBeTruthy()
    expect(screen.getByText(/line two changed/)).toBeTruthy()
  })

  it('does NOT render a Diff button on the oldest revision (no prior to compare)', () => {
    const revisions = [
      rev({ id: 'r-only', kind: 'create', summary: 'created', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('created').closest('.agent-history-row') as HTMLElement
    expect(within(row).queryByRole('button', { name: /diff/i })).toBeNull()
  })

  it('does NOT render a Diff button on a preset_change revision (only body_edit has diffs)', () => {
    const revisions = [
      rev({ id: 'r-new', kind: 'preset_change', summary: 'Added preset', created_at: '2026-05-25T17:00:00Z' }),
      rev({ id: 'r-old', kind: 'body_edit', body: 'b', summary: 'edit', created_at: '2026-05-25T10:00:00Z' }),
    ]
    render(<AgentHistoryTimeline revisions={revisions} onRestore={() => {}} />)
    const row = screen.getByText('Added preset').closest('.agent-history-row') as HTMLElement
    expect(within(row).queryByRole('button', { name: /diff/i })).toBeNull()
  })
})
