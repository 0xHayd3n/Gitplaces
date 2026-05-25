// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AgentVariablePresetBar from './AgentVariablePresetBar'
import type { AgentRow, AgentPreset } from '../types/agent'

const baseAgent: AgentRow = {
  id: 'a1',
  name: 'Reviewer',
  handle: 'reviewer',
  folder_id: null,
  color_start: '#6366f1',
  color_end: null,
  emoji: null,
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
  tools: null,
  model: 'inherit',
  is_subagent: 0,
  is_slash_command: 0,
  argument_hint: null,
  synced_subagent_at: null,
  synced_slash_command_at: null,
}

function withPresets(presets: AgentPreset[]): AgentRow {
  return { ...baseAgent, presets_json: JSON.stringify(presets) }
}

function makeApi() {
  return {
    agents: {
      presets: {
        create: vi.fn().mockImplementation(async (_aId: string, name: string, values: Record<string, string> = {}) => ({
          id: 'p-new', name, slug: name.toLowerCase().replace(/\s+/g, '-'), values,
        })),
        update: vi.fn().mockImplementation(async (_aId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }) => ({
          id: presetId, name: patch.name ?? 'X', slug: 'x', values: patch.values ?? {},
        })),
        delete: vi.fn().mockResolvedValue(undefined),
        duplicate: vi.fn().mockImplementation(async (_aId: string, presetId: string) => ({
          id: presetId + '-dup', name: 'dup', slug: 'dup', values: {},
        })),
      },
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
})

describe('AgentVariablePresetBar', () => {
  it('renders the variable grid for the detected variables', () => {
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        body=""
        variables={['focus', 'language']}
        activePresetId={null}
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByText('{{focus}}')).toBeTruthy()
    expect(screen.getByText('{{language}}')).toBeTruthy()
  })

  it('renders one row per preset with the callable sub-handle', () => {
    const agent = withPresets([
      { id: 'p1', name: 'Security review', slug: 'security-review', values: {} },
      { id: 'p2', name: 'Style nitpick', slug: 'style-nitpick', values: {} },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body=""
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByText('Security review')).toBeTruthy()
    expect(screen.getByText('Style nitpick')).toBeTruthy()
    expect(screen.getByText('@reviewer/security-review')).toBeTruthy()
    expect(screen.getByText('@reviewer/style-nitpick')).toBeTruthy()
  })

  it('clicking a preset row calls onActivePresetChange with its id', () => {
    const onActivePresetChange = vi.fn()
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: {} },
      { id: 'p2', name: 'B', slug: 'b', values: {} },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body=""
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={onActivePresetChange}
      />,
    )
    fireEvent.click(screen.getByText('B'))
    expect(onActivePresetChange).toHaveBeenCalledWith('p2')
  })

  it('variable inputs show the active preset\'s values', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth', language: 'TS' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body=""
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('focus') as HTMLInputElement).value).toBe('auth')
    expect((screen.getByLabelText('language') as HTMLInputElement).value).toBe('TS')
  })

  it('editing a variable input debounce-saves to the active preset', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body=""
        variables={['focus']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    const input = screen.getByLabelText('focus') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'SQL injection' } })
    expect(window.api.agents.presets.update).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(window.api.agents.presets.update).toHaveBeenCalledWith('a1', 'p1', { values: { focus: 'SQL injection' } })
    vi.useRealTimers()
  })

  it('clicking + New preset opens a name input, submitting creates with the typed name', async () => {
    const onActivePresetChange = vi.fn()
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        body=""
        variables={['focus']}
        activePresetId={null}
        onActivePresetChange={onActivePresetChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }))
    const nameInput = screen.getByPlaceholderText(/preset name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Quick scan' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() =>
      expect(window.api.agents.presets.create).toHaveBeenCalledWith('a1', 'Quick scan', {}),
    )
    await waitFor(() => expect(onActivePresetChange).toHaveBeenCalledWith('p-new'))
  })

  it('+ New preset snapshots the currently-typed values into the new preset', async () => {
    render(
      <AgentVariablePresetBar
        agent={baseAgent}
        body="Focus on {{focus}}."
        variables={['focus']}
        activePresetId={null}
        onActivePresetChange={() => {}}
      />,
    )
    const input = screen.getByLabelText('focus') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'auth' } })
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }))
    const nameInput = screen.getByPlaceholderText(/preset name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Auth scan' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() =>
      expect(window.api.agents.presets.create).toHaveBeenCalledWith('a1', 'Auth scan', { focus: 'auth' }),
    )
  })

  it('renders a copy-payload preview with substituted values', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth', language: 'TS' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body="Focus on {{focus}} for {{language}}."
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByTestId('agent-bar-preview').textContent).toContain('Focus on auth for TS.')
  })

  it('shows raw {{var}} in preview when the value is missing', () => {
    const agent = withPresets([
      { id: 'p1', name: 'A', slug: 'a', values: { focus: 'auth' } },
    ])
    render(
      <AgentVariablePresetBar
        agent={agent}
        body="Focus on {{focus}} for {{language}}."
        variables={['focus', 'language']}
        activePresetId="p1"
        onActivePresetChange={() => {}}
      />,
    )
    expect(screen.getByTestId('agent-bar-preview').textContent).toContain('{{language}}')
  })
})
