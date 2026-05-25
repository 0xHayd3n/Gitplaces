// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import AgentDetail from './AgentDetail'
import type { AgentRow, AgentFolderRow } from '../types/agent'

const folders: AgentFolderRow[] = [
  { id: 'f1', name: 'Writing', color_start: null, color_end: null, description: null, emoji: null, created_at: '2026-05-23T00:00:00Z' },
]
const baseAgent: AgentRow = {
  id: 'a1',
  name: 'Copy editor',
  handle: 'copy-editor',
  folder_id: 'f1',
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
  tools: null,
  model: 'inherit',
  model_provider: 'anthropic',
  model_endpoint_id: null,
  is_subagent: 0,
  is_slash_command: 0,
  argument_hint: null,
  synced_subagent_at: null,
  synced_slash_command_at: null,
}

function makeApi() {
  return {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders, agents: [baseAgent] }),
      update: vi.fn().mockImplementation(async (_id: string, patch: any) => ({
        ...baseAgent, ...patch, updated_at: '2026-05-23T00:00:05Z',
      })),
      delete: vi.fn(),
      duplicate: vi.fn(),
      recordUse: vi.fn().mockResolvedValue(undefined),
      primaryContent: vi.fn().mockResolvedValue({
        id: 'pf-a1', filename: 'copy-editor.md', content: '# Copy editor\n\nHello body.', updated_at: baseAgent.updated_at,
      }),
      mcp: {
        getConfigSnippet: vi.fn().mockResolvedValue(JSON.stringify({
          mcpServers: { 'git-suite-agents': { command: 'node', args: ['/path/to/mcp-launcher.cjs', '/path/to/db'] } },
        }, null, 2)),
      },
      onChanged: vi.fn(),
      offChanged: vi.fn(),
      onRevisionAdded: vi.fn(),
      offRevisionAdded: vi.fn(),
      revisions: {
        list: vi.fn().mockResolvedValue([]),
        revert: vi.fn(),
      },
      sync: {
        checkConflict: vi.fn().mockResolvedValue({
          subagentExists: false,
          slashCommandExists: false,
          subagentPath: '/home/user/.claude/agents/copy-editor.md',
          slashCommandPath: '/home/user/.claude/commands/copy-editor.md',
        }),
        retry: vi.fn().mockResolvedValue({
          subagent: { status: 'skipped' },
          slashCommand: { status: 'skipped' },
        }),
        preview: vi.fn().mockResolvedValue({ subagent: null, slashCommand: null }),
      },
      files: {
        list: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
  }
}

beforeEach(() => {
  ;(window as any).api = makeApi()
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  return render(
    <MemoryRouter initialEntries={['/library/agent/a1']}>
      <Routes>
        <Route path="/library/agent/:id" element={<AgentDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Wait for the agent header (h2) to appear — the body markdown also renders "Copy editor" as h1
async function waitForLoaded() {
  await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
}

describe('AgentDetail', () => {
  it('renders the hero with scoped handle, title, swatch and meta chips', async () => {
    setup()
    await waitForLoaded()
    // Title (name) is the h2
    expect(screen.getByRole('heading', { level: 2, name: 'Copy editor' })).toBeTruthy()
    // Handle row shows the scope prefix and the local part
    expect(screen.getByText('git-suite/')).toBeTruthy()
    expect(screen.getByText('copy-editor')).toBeTruthy()
    // Swatch is now a button with aria-label "Edit appearance"
    expect(screen.getByRole('button', { name: /edit appearance/i })).toBeTruthy()
    // Folder name appears in both the header chip and the Overview chip — at least one matches
    expect(screen.getAllByText('Writing').length).toBeGreaterThanOrEqual(1)
  })

  it('renders explicit description from agent.description in the hero', async () => {
    const withDesc: AgentRow = { ...baseAgent, description: 'My explicit description' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [withDesc] })
    setup()
    await waitForLoaded()
    // Description renders in the header AND on the Overview tab — both ok
    expect(screen.getAllByText('My explicit description').length).toBeGreaterThanOrEqual(1)
  })

  it('renders origin chip when agent.origin_plugin is set', async () => {
    const imported: AgentRow = { ...baseAgent, origin_plugin: 'superpowers', origin_version: '5.1.0' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [imported] })
    setup()
    await waitForLoaded()
    expect(screen.getByText(/from superpowers v5\.1\.0/i)).toBeTruthy()
  })

  it('handle copy icon copies @git-suite/<handle> to the clipboard', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /copy @git-suite\/copy-editor/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const text = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(text).toBe('@git-suite/copy-editor')
  })

  it('shows the folder name as a meta chip', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getAllByText('Writing').length).toBeGreaterThanOrEqual(1)  // f1 folder name
  })

  it('double-clicking the title enters rename mode', async () => {
    setup()
    await waitForLoaded()
    const title = screen.getByRole('heading', { level: 2, name: 'Copy editor' })
    fireEvent.click(title)
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    fireEvent.doubleClick(title)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  })

  it('double-clicking the handle local part enters handle edit mode', async () => {
    setup()
    await waitForLoaded()
    const handleSpan = screen.getByText('copy-editor')
    fireEvent.doubleClick(handleSpan)
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    expect(input.value).toBe('copy-editor')
  })

  it('handle edit saves a valid new handle on blur', async () => {
    setup()
    await waitForLoaded()
    fireEvent.doubleClick(screen.getByText('copy-editor'))
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'new-handle' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { handle: 'new-handle' }),
    )
  })

  it('handle edit rejects an invalid handle without saving', async () => {
    setup()
    await waitForLoaded()
    fireEvent.doubleClick(screen.getByText('copy-editor'))
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'INVALID!' } })
    fireEvent.blur(input)
    expect(window.api.agents.update).not.toHaveBeenCalledWith('a1', { handle: 'INVALID!' })
    expect(input.className).toContain('agent-detail-handle-input--error')
  })

  it('Escape reverts handle edit without saving', async () => {
    setup()
    await waitForLoaded()
    fireEvent.doubleClick(screen.getByText('copy-editor'))
    const input = screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'something-else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    // Input is gone, span is back with the original handle
    expect(screen.queryByRole('textbox', { name: 'Handle' })).toBeNull()
    expect(screen.getByText('copy-editor')).toBeTruthy()
    expect(window.api.agents.update).not.toHaveBeenCalledWith('a1', { handle: 'something-else' })
  })

  it('tab bar includes Overview, Preview, MCP, History, Files, Settings', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /overview/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /mcp/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /history/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /settings/i })).toBeTruthy()
  })

  it('switches the rendered body when navigating between agents', async () => {
    const otherAgent: AgentRow = {
      id: 'a2',
      name: 'Other agent',
      handle: 'other-agent',
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
      model_provider: 'anthropic',
      model_endpoint_id: null,
      is_subagent: 0,
      is_slash_command: 0,
      argument_hint: null,
      synced_subagent_at: null,
      synced_slash_command_at: null,
    }
    ;(window as any).api.agents.getAll = vi.fn()
      .mockResolvedValueOnce({ folders, agents: [baseAgent] })
      .mockResolvedValueOnce({ folders, agents: [otherAgent] })
    ;(window as any).api.agents.primaryContent = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === 'a2'
        ? { id: 'pf-a2', filename: 'other-agent.md', content: '# Other\n\nother body.', updated_at: otherAgent.updated_at }
        : { id: 'pf-a1', filename: 'copy-editor.md', content: '# Copy editor\n\nHello body.', updated_at: baseAgent.updated_at }))

    function NavButton() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/library/agent/a2')}>Go to a2</button>
    }

    render(
      <MemoryRouter initialEntries={['/library/agent/a1']}>
        <NavButton />
        <Routes>
          <Route path="/library/agent/:id" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.click(screen.getByText('Go to a2'))
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Other agent' }))
    // Body lives in the Preview tab now (markdown render). Click Preview to inspect.
    fireEvent.click(screen.getByRole('tab', { name: /preview/i }))
    await waitFor(() => expect(screen.getAllByText(/other body\./).length).toBeGreaterThan(0))
  })

  it('shows nameDraft in header after inline name edit even before save resolves', async () => {
    setup()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Copy editor' }))
    fireEvent.doubleClick(screen.getByRole('heading', { level: 2 }))
    const nameInput = screen.getByDisplayValue('Copy editor') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Renamed agent' } })
    fireEvent.blur(nameInput)
    // After blur, header should reflect the new name (nameDraft), not stale agent.name
    expect(screen.getByRole('heading', { level: 2, name: 'Renamed agent' })).toBeTruthy()
  })

})

describe('AgentDetail — tabs', () => {
  it('renders the six tab buttons with Overview active by default', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('tab', { name: /overview/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /mcp/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /history/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /settings/i })).toBeTruthy()
  })

  it('Preview tab renders markdown of agent.body', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /preview/i }))
    // The markdown body contains `# Copy editor` — appears as h1 in the rendered output
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Copy editor' })).toBeTruthy()
    })
  })

  it('Settings tab Folder dropdown changes the agent\'s folder', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const select = screen.getByLabelText(/folder/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__unfiled' } })
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { folderId: null }),
    )
  })

  it('Settings tab "Copy entire prompt" copies the persona payload', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor/)
    expect(payload).toContain('Hello body.')
  })

  it('Settings tab "Copy entire prompt" reflects the latest primary file content', async () => {
    // Body now lives in agent_files; the renderer fetches it via primaryContent
    // on agent load. Override the mock to simulate a different stored body.
    ;(window as any).api.agents.primaryContent = vi.fn().mockResolvedValue({
      id: 'pf-a1', filename: 'copy-editor.md', content: 'updated body content', updated_at: '2026-05-23T00:00:00Z',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toContain('updated body content')
  })

  it('Settings tab Duplicate button calls api.agents.duplicate', async () => {
    ;(window as any).api.agents.duplicate = vi.fn().mockResolvedValue({ id: 'a-dup' })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Duplicate$/ }))
    await waitFor(() => expect(window.api.agents.duplicate).toHaveBeenCalledWith('a1'))
  })

  it('Settings tab Delete button confirms and calls api.agents.delete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(window as any).api.agents.delete = vi.fn().mockResolvedValue(undefined)
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete agent/i }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(window.api.agents.delete).toHaveBeenCalledWith('a1'))
    confirmSpy.mockRestore()
  })
})

describe('AgentDetail — variable/preset bar integration', () => {
  it('does NOT render the bar when the body has no {{variables}}', async () => {
    setup()
    await waitForLoaded()
    expect(screen.queryByText('PRESETS')).toBeNull()
  })

  it('renders variable chips on the Overview hero when variables are present', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [baseAgent] })
    ;(window as any).api.agents.primaryContent = vi.fn().mockResolvedValue({
      id: 'pf-a1', filename: 'copy-editor.md', content: 'Look at {{focus}} for {{language}}.', updated_at: '2026-05-23T00:00:00Z',
    })
    setup()
    await waitForLoaded()
    expect(screen.getAllByText('{{focus}}').length).toBeGreaterThan(0)
    expect(screen.getAllByText('{{language}}').length).toBeGreaterThan(0)
  })

  it('Settings Copy entire prompt uses preset sub-handle and substitutes variables when a preset is active', async () => {
    const agentWithPreset: AgentRow = {
      ...baseAgent,
      presets_json: JSON.stringify([
        { id: 'p1', name: 'Security review', slug: 'security-review',
          values: { focus: 'auth', language: 'TS' } },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithPreset] })
    ;(window as any).api.agents.primaryContent = vi.fn().mockResolvedValue({
      id: 'pf-a1', filename: 'copy-editor.md', content: 'Look at {{focus}} for {{language}}.', updated_at: '2026-05-23T00:00:00Z',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor\/security-review/)
    expect(payload).toContain('Look at auth for TS.')
  })

  it('Settings Copy entire prompt leaves variables raw when no preset is active', async () => {
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [baseAgent] })
    ;(window as any).api.agents.primaryContent = vi.fn().mockResolvedValue({
      id: 'pf-a1', filename: 'copy-editor.md', content: 'Look at {{focus}}.', updated_at: '2026-05-23T00:00:00Z',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const payload = (navigator.clipboard.writeText as any).mock.calls[0][0] as string
    expect(payload).toMatch(/^You are @copy-editor,/)
    expect(payload).toContain('Look at {{focus}}.')
  })
})

describe('AgentDetail — History tab', () => {
  const revisionsFixture: import('../types/agent').AgentRevision[] = [
    {
      id: 'rev-2', agent_id: 'a1', body: 'v2', presets: [],
      summary: 'Edited body', kind: 'body_edit',
      created_at: '2026-05-25T15:00:00Z',
    },
    {
      id: 'rev-1', agent_id: 'a1', body: 'v1', presets: [],
      summary: 'Created agent', kind: 'create',
      created_at: '2026-05-25T10:00:00Z',
    },
  ]

  beforeEach(() => {
    ;(window as any).api.agents.revisions = {
      list: vi.fn().mockResolvedValue(revisionsFixture),
      revert: vi.fn().mockResolvedValue({ ...baseAgent }),
    }
    ;(window as any).api.agents.onRevisionAdded = vi.fn()
    ;(window as any).api.agents.offRevisionAdded = vi.fn()
  })

  it('fetches revisions when the History tab is opened', async () => {
    setup()
    await waitForLoaded()
    expect(window.api.agents.revisions.list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await waitFor(() => expect(window.api.agents.revisions.list).toHaveBeenCalledWith('a1'))
    expect(await screen.findByText('Edited body')).toBeTruthy()
    expect(await screen.findByText('Created agent')).toBeTruthy()
  })

  it('clicking Restore calls window.api.agents.revisions.revert', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    const oldRow = screen.getByText('Created agent').closest('.agent-history-row') as HTMLElement
    fireEvent.click(within(oldRow).getByRole('button', { name: /restore/i }))
    await waitFor(() => expect(window.api.agents.revisions.revert).toHaveBeenCalledWith('a1', 'rev-1'))
  })

  it('subscribes to onRevisionAdded when the component mounts and unsubscribes on unmount', async () => {
    const { unmount } = setup()
    await waitForLoaded()
    expect(window.api.agents.onRevisionAdded).toHaveBeenCalled()
    unmount()
    expect(window.api.agents.offRevisionAdded).toHaveBeenCalled()
  })

  it('prepends an incoming revision-added event to the timeline', async () => {
    let listener: ((rev: import('../types/agent').AgentRevision) => void) | null = null
    ;(window as any).api.agents.onRevisionAdded = vi.fn((cb: any) => { listener = cb })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    expect(listener).not.toBeNull()
    act(() => {
      listener!({
        id: 'rev-3', agent_id: 'a1', body: 'v3', presets: [],
        summary: 'Updated preset "X"', kind: 'preset_change',
        created_at: '2026-05-25T17:00:00Z',
      })
    })
    expect(await screen.findByText('Updated preset "X"')).toBeTruthy()
  })

  it('ignores revision-added events for a different agent', async () => {
    let listener: ((rev: import('../types/agent').AgentRevision) => void) | null = null
    ;(window as any).api.agents.onRevisionAdded = vi.fn((cb: any) => { listener = cb })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^History$/ }))
    await screen.findByText('Edited body')
    act(() => {
      listener!({
        id: 'rev-other', agent_id: 'OTHER', body: 'x', presets: [],
        summary: 'Other agent edit', kind: 'body_edit',
        created_at: '2026-05-25T18:00:00Z',
      })
    })
    expect(screen.queryByText('Other agent edit')).toBeNull()
  })
})

describe('AgentDetail — recordUse on Copy entire prompt', () => {
  it('calls window.api.agents.recordUse with the agent id and null preset after a successful Copy', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(window.api.agents.recordUse).toHaveBeenCalledWith('a1', null))
  })

  it('passes the active preset id when one is selected', async () => {
    const agentWithPreset: AgentRow = {
      ...baseAgent,
      presets_json: JSON.stringify([
        { id: 'p-sec', name: 'Security review', slug: 'security-review', values: { focus: 'auth' } },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [agentWithPreset] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await waitFor(() => expect(window.api.agents.recordUse).toHaveBeenCalledWith('a1', 'p-sec'))
  })

  it('does NOT call recordUse if clipboard write fails', async () => {
    ;(navigator.clipboard.writeText as any) = vi.fn().mockRejectedValue(new Error('denied'))
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy entire prompt/i }))
    await new Promise(r => setTimeout(r, 0))
    expect(window.api.agents.recordUse).not.toHaveBeenCalled()
  })
})

describe('AgentDetail — pin toggle', () => {
  it('renders a Pin button when the agent is not pinned', async () => {
    setup()
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /^Pin$/ })).toBeTruthy()
  })

  it('renders an Unpin button when the agent is pinned', async () => {
    const pinnedAgent: AgentRow = { ...baseAgent, pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [pinnedAgent] })
    setup()
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /^Unpin$/ })).toBeTruthy()
  })

  it('clicking Pin calls window.api.agents.update with pinned: true', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /^Pin$/ }))
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { pinned: true }))
  })

  it('clicking Unpin calls window.api.agents.update with pinned: false', async () => {
    const pinnedAgent: AgentRow = { ...baseAgent, pinned: 1, pinned_at: '2026-05-25T00:00:00Z' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [pinnedAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /^Unpin$/ }))
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { pinned: false }))
  })
})

describe('AgentDetail — MCP tab', () => {
  it('renders the resource URIs for the current agent', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    expect(await screen.findByText('agent://copy-editor')).toBeTruthy()
  })

  it('renders preset sub-handle URIs when the agent has presets', async () => {
    const withPresets: AgentRow = {
      ...baseAgent,
      presets_json: JSON.stringify([
        { id: 'p1', name: 'Security', slug: 'security-review', values: {} },
      ]),
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [withPresets] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    expect(await screen.findByText('agent://copy-editor/security-review')).toBeTruthy()
  })

  it('Copy MCP config button writes the snippet to the clipboard', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /^MCP$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /copy mcp config/i }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('git-suite-agents')),
    )
  })
})

describe('AgentDetail — Settings tab Phase 2', () => {
  // --- Model & tools ---

  it('Model dropdown renders current value selected; changing it calls update with the new model', async () => {
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const select = screen.getByLabelText(/^Model$/) as HTMLSelectElement
    expect(select.value).toBe('inherit')
    fireEvent.change(select, { target: { value: 'opus' } })
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { model: 'opus' }),
    )
  })

  it('Tools picker shows "Inherit all" selected when tools=null; switching to "Restrict to:" calls update with []', async () => {
    setup() // baseAgent.tools === null
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const inheritRadio = screen.getByLabelText(/inherit all/i) as HTMLInputElement
    expect(inheritRadio.checked).toBe(true)
    fireEvent.click(screen.getByLabelText(/restrict to/i))
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { tools: [] }),
    )
  })

  it('Toggling a tool checkbox in the grid calls update with the new tools array', async () => {
    const restrictedAgent: AgentRow = { ...baseAgent, tools: '[]' }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [restrictedAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const readCheckbox = screen.getByLabelText(/^Read$/) as HTMLInputElement
    expect(readCheckbox.checked).toBe(false)
    fireEvent.click(readCheckbox)
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { tools: ['Read'] }),
    )
  })

  // --- Surface toggles + conflict dialog ---

  it('Subagent toggle ON without conflict calls update({ isSubagent: true }) and does not open the dialog', async () => {
    // makeApi default: subagentExists=false
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/available as subagent/i))
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { isSubagent: true }),
    )
    expect(screen.queryByText(/subagent file exists/i)).toBeNull()
  })

  it('Subagent toggle ON with subagentExists=true opens ConflictDialog and does not call update', async () => {
    ;(window as any).api.agents.sync.checkConflict = vi.fn().mockResolvedValue({
      subagentExists: true,
      slashCommandExists: false,
      subagentPath: '/home/user/.claude/agents/copy-editor.md',
      slashCommandPath: '/home/user/.claude/commands/copy-editor.md',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/available as subagent/i))
    expect(await screen.findByText(/subagent file exists/i)).toBeTruthy()
    expect(window.api.agents.update).not.toHaveBeenCalled()
  })

  it('ConflictDialog Cancel closes the dialog and does not call update', async () => {
    ;(window as any).api.agents.sync.checkConflict = vi.fn().mockResolvedValue({
      subagentExists: true,
      slashCommandExists: false,
      subagentPath: '/home/user/.claude/agents/copy-editor.md',
      slashCommandPath: '/home/user/.claude/commands/copy-editor.md',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/available as subagent/i))
    await screen.findByText(/subagent file exists/i)
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => expect(screen.queryByText(/subagent file exists/i)).toBeNull())
    expect(window.api.agents.update).not.toHaveBeenCalled()
  })

  it('ConflictDialog Overwrite calls update({ isSubagent: true, forceOverwrite: true })', async () => {
    ;(window as any).api.agents.sync.checkConflict = vi.fn().mockResolvedValue({
      subagentExists: true,
      slashCommandExists: false,
      subagentPath: '/home/user/.claude/agents/copy-editor.md',
      slashCommandPath: '/home/user/.claude/commands/copy-editor.md',
    })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    fireEvent.click(screen.getByLabelText(/available as subagent/i))
    await screen.findByText(/subagent file exists/i)
    fireEvent.click(screen.getByRole('button', { name: /^Overwrite$/ }))
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', {
        isSubagent: true,
        forceOverwrite: true,
      }),
    )
  })

  it('Subagent toggle OFF calls update({ isSubagent: false }) without a dialog or forceOverwrite', async () => {
    const enabledAgent: AgentRow = {
      ...baseAgent,
      is_subagent: 1,
      synced_subagent_at: '2026-05-25T10:00:00Z',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [enabledAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const checkbox = screen.getByLabelText(/available as subagent/i) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(window.api.agents.update).toHaveBeenCalledWith('a1', { isSubagent: false }),
    )
    expect(screen.queryByText(/subagent file exists/i)).toBeNull()
  })

  // --- Argument hint ---

  it('argument_hint input is hidden when is_slash_command=0', async () => {
    setup() // baseAgent.is_slash_command === 0
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    expect(screen.queryByLabelText(/argument hint/i)).toBeNull()
  })

  it('argument_hint input is visible and pre-filled when is_slash_command=1', async () => {
    const slashAgent: AgentRow = {
      ...baseAgent,
      is_slash_command: 1,
      argument_hint: '[project-name]',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [slashAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    const input = screen.getByLabelText(/argument hint/i) as HTMLInputElement
    expect(input.value).toBe('[project-name]')
  })

  // --- Sync status line ---

  it('Sync status renders "Will sync on next save" when toggle is on but synced_subagent_at is null', async () => {
    const enabledAgent: AgentRow = {
      ...baseAgent,
      is_subagent: 1,
      synced_subagent_at: null,
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [enabledAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    expect(screen.getByText(/will sync on next save/i)).toBeTruthy()
  })

  it('Sync status renders "Synced to <path> · Xm ago" when synced_subagent_at is set', async () => {
    const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const enabledAgent: AgentRow = {
      ...baseAgent,
      is_subagent: 1,
      synced_subagent_at: tenMinAgoIso,
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [enabledAgent] })
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    // "Synced to" and the relative time render synchronously from props
    expect(screen.getByText(/Synced to/)).toBeTruthy()
    expect(screen.getByText(/10m ago/)).toBeTruthy()
    // The clickable path appears after sync.checkConflict resolves
    await waitFor(() => expect(screen.getByText(/copy-editor\.md/)).toBeTruthy())
  })

  // --- Sibling files info chip ---

  it('Sibling-files info chip appears when is_subagent=1 AND the agent has files', async () => {
    const enabledAgent: AgentRow = {
      ...baseAgent,
      is_subagent: 1,
      synced_subagent_at: '2026-05-25T10:00:00Z',
    }
    ;(window as any).api.agents.getAll = vi.fn().mockResolvedValue({ folders, agents: [enabledAgent] })
    ;(window as any).api.agents.files.list = vi.fn().mockResolvedValue([
      { id: 'f1', agent_id: 'a1', filename: 'reference.md', content: '', sort_order: 0, created_at: '', updated_at: '' },
      { id: 'f2', agent_id: 'a1', filename: 'script.sh',    content: '', sort_order: 1, created_at: '', updated_at: '' },
      { id: 'f3', agent_id: 'a1', filename: 'notes.md',     content: '', sort_order: 2, created_at: '', updated_at: '' },
    ])
    setup()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }))
    await waitFor(() => expect(screen.getByText(/Sibling files \(3\)/)).toBeTruthy())
  })
})
