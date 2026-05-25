import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgentOverviewTab from './AgentOverviewTab'
import type { AgentRow, AgentFolderRow, AgentRevision, AgentPreset } from '../types/agent'

const baseAgent: AgentRow = {
  id: 'a-1', name: 'My Agent', handle: 'my-agent',
  body: 'persona body',
  folder_id: null, color_start: '#888', color_end: null, emoji: null,
  pinned: 0, pinned_at: null, last_used_at: null, presets_json: '[]',
  created_at: '2026-05-20T00:00:00Z', updated_at: '2026-05-25T00:00:00Z',
  description: 'A test agent.',
  origin_plugin: null, origin_path: null, origin_version: null, origin_imported_at: null,
  tools: null, model: 'inherit',
  is_subagent: 0, is_slash_command: 0, argument_hint: null,
  synced_subagent_at: null, synced_slash_command_at: null,
}

function setup(overrides: {
  agent?: Partial<AgentRow>
  folders?: AgentFolderRow[]
  liveBody?: string
  presets?: AgentPreset[]
  recentRevisions?: AgentRevision[]
  fileCount?: number
  activePresetId?: string | null
  onCopy?: () => void
  onOpenEditor?: () => void
  onTabChange?: (tab: 'preview' | 'mcp' | 'history' | 'files' | 'settings') => void
  onActivePresetChange?: (id: string | null) => void
} = {}) {
  const agent = { ...baseAgent, ...overrides.agent }
  const onCopy = overrides.onCopy ?? vi.fn()
  const onOpenEditor = overrides.onOpenEditor ?? vi.fn()
  const onTabChange = overrides.onTabChange ?? vi.fn()
  const onActivePresetChange = overrides.onActivePresetChange ?? vi.fn()
  render(
    <MemoryRouter>
      <AgentOverviewTab
        agent={agent}
        folders={overrides.folders ?? []}
        liveBody={overrides.liveBody ?? 'persona body'}
        presets={overrides.presets ?? []}
        activePresetId={overrides.activePresetId ?? null}
        recentRevisions={overrides.recentRevisions ?? []}
        fileCount={overrides.fileCount ?? 1}
        onCopy={onCopy}
        onOpenEditor={onOpenEditor}
        onTabChange={onTabChange}
        onActivePresetChange={onActivePresetChange}
      />
    </MemoryRouter>
  )
  return { onCopy, onOpenEditor, onTabChange, onActivePresetChange }
}

describe('AgentOverviewTab — hero', () => {
  it('renders description prominently', () => {
    setup({ agent: { description: 'A drafting partner.' } })
    expect(screen.getByText('A drafting partner.')).toBeTruthy()
  })

  it('falls back to derived description with hint when explicit description is empty', () => {
    setup({ agent: { description: '' }, liveBody: 'You are a helpful drafting partner.' })
    expect(screen.getByText(/Set an explicit description/i)).toBeTruthy()
  })

  it('shows the chip strip with folder/model/files', () => {
    setup({
      agent: { model: 'sonnet' },
      fileCount: 4,
    })
    expect(screen.getByText(/sonnet/i)).toBeTruthy()
    expect(screen.getByText(/4 files/i)).toBeTruthy()
  })

  it('Copy button calls onCopy', () => {
    const { onCopy } = setup()
    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(onCopy).toHaveBeenCalled()
  })

  it('Open in editor button calls onOpenEditor', () => {
    const { onOpenEditor } = setup()
    fireEvent.click(screen.getByRole('button', { name: /open in editor/i }))
    expect(onOpenEditor).toHaveBeenCalled()
  })
})

describe('AgentOverviewTab — preset row', () => {
  it('hides the preset row when no presets exist', () => {
    setup({ presets: [] })
    expect(screen.queryByText(/active preset/i)).toBeNull()
  })

  it('shows the preset dropdown when presets exist', () => {
    const presets: AgentPreset[] = [
      { id: 'p1', name: 'Default', slug: 'default', values: {} },
      { id: 'p2', name: 'Concise', slug: 'concise', values: {} },
    ]
    setup({ presets, activePresetId: 'p1' })
    expect(screen.getByText(/active preset/i)).toBeTruthy()
    expect(screen.getByDisplayValue('Default')).toBeTruthy()
  })

  it('changing the preset calls onActivePresetChange', () => {
    const presets: AgentPreset[] = [
      { id: 'p1', name: 'Default', slug: 'default', values: {} },
      { id: 'p2', name: 'Concise', slug: 'concise', values: {} },
    ]
    const { onActivePresetChange } = setup({ presets, activePresetId: 'p1' })
    fireEvent.change(screen.getByLabelText(/active preset/i), { target: { value: 'p2' } })
    expect(onActivePresetChange).toHaveBeenCalledWith('p2')
  })
})

describe('AgentOverviewTab — surface cards', () => {
  it('shows "Disabled" for both surfaces when neither is enabled', () => {
    setup()
    expect(screen.getAllByText(/disabled/i).length).toBeGreaterThanOrEqual(2)
  })

  it('shows synced state when subagent is enabled and synced', () => {
    setup({
      agent: {
        is_subagent: 1,
        synced_subagent_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      },
    })
    expect(screen.getByText(/synced/i)).toBeTruthy()
  })
})

describe('AgentOverviewTab — variables card', () => {
  it('hides the variables card when body has no variables', () => {
    setup({ liveBody: 'plain text, no placeholders' })
    expect(screen.queryByText(/^variables$/i)).toBeNull()
  })

  it('shows detected variables when body contains {{var}}', () => {
    setup({ liveBody: 'Hello {{topic}}, please {{action}}.' })
    expect(screen.getAllByText(/\{\{topic\}\}/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\{\{action\}\}/).length).toBeGreaterThan(0)
  })
})

describe('AgentOverviewTab — recent revisions', () => {
  it('shows empty state when no revisions', () => {
    setup({ recentRevisions: [] })
    expect(screen.getByText(/no revisions yet/i)).toBeTruthy()
  })

  it('lists up to 3 most-recent revisions', () => {
    const revisions: AgentRevision[] = [
      { id: 'r1', agent_id: 'a-1', body: '', presets: [], summary: 'Edited body',  kind: 'body_edit', created_at: new Date().toISOString() },
      { id: 'r2', agent_id: 'a-1', body: '', presets: [], summary: 'Added preset', kind: 'preset_change', created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 'r3', agent_id: 'a-1', body: '', presets: [], summary: 'Renamed',      kind: 'preset_change', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 'r4', agent_id: 'a-1', body: '', presets: [], summary: 'Created',      kind: 'create', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    ]
    setup({ recentRevisions: revisions })
    expect(screen.getByText('Edited body')).toBeTruthy()
    expect(screen.getByText('Added preset')).toBeTruthy()
    expect(screen.getByText('Renamed')).toBeTruthy()
    expect(screen.queryByText('Created')).toBeNull()
  })

  it('"View all" link triggers tab change to history', () => {
    const revisions: AgentRevision[] = [
      { id: 'r1', agent_id: 'a-1', body: '', presets: [], summary: 'Edited body', kind: 'body_edit', created_at: new Date().toISOString() },
    ]
    const { onTabChange } = setup({ recentRevisions: revisions })
    fireEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(onTabChange).toHaveBeenCalledWith('history')
  })
})
