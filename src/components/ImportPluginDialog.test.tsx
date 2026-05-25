// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportPluginDialog from './ImportPluginDialog'

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders: [], agents: [] }),
      createFolder: vi.fn().mockResolvedValue({ id: 'newFolder', name: 'superpowers', color_start: null, color_end: null, description: null, emoji: null, created_at: 't' }),
      import: {
        discoverPlugins: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'superpowers', version: '5.1.0', root: '/p1', subagents: [], slashCommands: [], skills: [
            { name: 'brainstorming', path: '/p1/skills/brainstorming', description: 'Brainstorm things', fileCount: 4 },
            { name: 'writing-plans', path: '/p1/skills/writing-plans', description: 'Plan things', fileCount: 2 },
          ]},
          { id: 'p2', name: 'anatomy', version: null, root: '/p2', subagents: [], slashCommands: [], skills: [
            { name: 'foo', path: '/p2/skills/foo', description: null, fileCount: 1 },
          ]},
        ]),
        readTargetFromDisk: vi.fn().mockImplementation(async (p: string, _kind: string) => ({
          kind: 'skill', name: p.split('/').pop(), handle: p.split('/').pop(), description: '', body: '', files: [], origin: null,
        })),
        importTarget: vi.fn().mockResolvedValue({ agentId: 'new', conflictResolved: 'created' }),
        discoverPluginInRepo: vi.fn().mockResolvedValue({
          owner: 'obra', name: 'superpowers', branch: 'main', commitSha: 'a1b2c3d4567',
          layout: 'plugin',
          subagents: [],
          slashCommands: [],
          skills: [
            { name: 'brainstorming', path: 'skills/brainstorming', description: 'Brainstorm', fileCount: 3 },
            { name: 'plan-writing',  path: 'skills/plan-writing',  description: 'Plan',       fileCount: 2 },
          ],
        }),
        readTargetFromRepo: vi.fn().mockImplementation(async (
          owner: string, name: string, _branch: string, sha: string, repoPath: string, _kind: string,
        ) => ({
          kind: 'skill',
          name: repoPath.split('/').pop(),
          handle: repoPath.split('/').pop(),
          description: '',
          body: '',
          files: [],
          origin: { plugin: `${owner}/${name}`, pluginVersion: sha.slice(0, 7), path: repoPath },
        })),
      },
    },
  }
})

describe('ImportPluginDialog', () => {
  it('lists discovered plugins on open', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    expect(screen.getByText('superpowers')).toBeTruthy()
    expect(screen.getByText('anatomy')).toBeTruthy()
    expect(screen.getByText(/v5\.1\.0/)).toBeTruthy()
    expect(screen.getByText(/2 items/)).toBeTruthy()
    expect(screen.getByText(/1 item$/)).toBeTruthy()
  })

  it('clicking a plugin expands its skill list', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    expect(screen.getByText('brainstorming')).toBeTruthy()
    expect(screen.getByText('writing-plans')).toBeTruthy()
  })

  it('importing a plugin reads each selected skill and calls importTarget', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 2 items/i }))
    await waitFor(() => expect(window.api.agents.import.importTarget).toHaveBeenCalledTimes(2))
  })

  it('creates a folder named after the plugin when none exists', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 2 items/i }))
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('superpowers'))
  })
})

describe('ImportPluginDialog — GitHub section', () => {
  it('renders a URL input and a disabled Fetch button when URL is empty', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    const input = screen.getByPlaceholderText(/owner\/repo/i)
    expect(input).toBeTruthy()
    const fetchBtn = screen.getByRole('button', { name: /^fetch$/i })
    expect((fetchBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Fetch when the URL is valid', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    expect((screen.getByRole('button', { name: /^fetch$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an inline parse error for an invalid URL', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'not-a-valid-url' } })
    expect(screen.getByText(/not a valid github url/i)).toBeTruthy()
  })

  it('on Fetch, calls discoverPluginInRepo and renders the skill list', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => expect(window.api.agents.import.discoverPluginInRepo).toHaveBeenCalledWith('obra/superpowers'))
    await waitFor(() => screen.getByText('plan-writing'))
    expect(screen.getByText('brainstorming')).toBeTruthy()
  })

  it('shows empty-state message when discoverPluginInRepo returns no targets', async () => {
    ;(window.api.agents.import.discoverPluginInRepo as any) = vi.fn().mockResolvedValue({
      owner: 'o', name: 'r', branch: 'main', commitSha: 'sha', layout: 'plugin', skills: [], subagents: [], slashCommands: [],
    })
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'o/r' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/no skills, sub-agents, or slash commands found/i))
  })

  it('shows an error message when discoverPluginInRepo rejects', async () => {
    ;(window.api.agents.import.discoverPluginInRepo as any) = vi.fn().mockRejectedValue(new Error("Couldn't load priv/repo"))
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'priv/repo' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/couldn't load/i))
  })

  it('Import calls readTargetFromRepo + importTarget for each selected skill', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 items/i }))
    await waitFor(() => expect(window.api.agents.import.readTargetFromRepo).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(window.api.agents.import.importTarget).toHaveBeenCalledTimes(2))
  })

  it('creates a folder named after the repo on import', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 items/i }))
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('superpowers'))
  })

  it('isolates per-skill failures and surfaces them in the end-of-batch alert', async () => {
    // First skill's readTargetFromRepo throws; second succeeds. The batch must
    // continue, call importTarget for the second, and surface the failure via
    // window.alert without aborting onClose.
    ;(window.api.agents.import.readTargetFromRepo as any) = vi.fn()
      .mockRejectedValueOnce(new Error('boom for skill 1'))
      .mockResolvedValueOnce({
        kind: 'skill', name: 'plan-writing', handle: 'plan-writing', description: '', body: '', files: [],
        origin: { plugin: 'obra/superpowers', pluginVersion: 'a1b2c3d', path: 'skills/plan-writing' },
      })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onClose = vi.fn()

    render(<ImportPluginDialog open onClose={onClose} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 items/i }))

    // Both readTargetFromRepo calls happen (one throws, one resolves) — failure
    // is isolated to the first skill.
    await waitFor(() => expect(window.api.agents.import.readTargetFromRepo).toHaveBeenCalledTimes(2))
    // Only the successful skill makes it to importTarget.
    await waitFor(() => expect(window.api.agents.import.importTarget).toHaveBeenCalledTimes(1))
    // Failure surfaced in alert with the failed skill's name + error message.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1)
      const msg = alertSpy.mock.calls[0][0] as string
      expect(msg).toMatch(/1 issue/i)
      expect(msg).toContain('brainstorming')
      expect(msg).toContain('boom for skill 1')
    })
    // onClose is still called after the batch despite the failure.
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    alertSpy.mockRestore()
  })
})

describe('ImportPluginDialog — mixed kinds', () => {
  beforeEach(() => {
    ;(window.api.agents.import.discoverPlugins as any) = vi.fn().mockResolvedValue([
      {
        id: 'mixed', name: 'mixed-plugin', version: '1.0.0', root: '/m',
        skills:        [{ name: 'a-skill',  path: '/m/skills/a-skill', description: 'A',     fileCount: 1 }],
        subagents:     [{ name: 'agent-1',  path: '/m/agents/agent-1.md',  description: 'AG',  color: 'green' }],
        slashCommands: [{ name: 'cmd-1',    path: '/m/commands/cmd-1.md',  description: 'CMD', argumentHint: '[x]' }],
      },
    ])
    ;(window.api.agents.import.readTargetFromDisk as any) = vi.fn().mockImplementation(async (p: string, kind: string) => ({
      kind, name: p.split('/').pop(), handle: p.split('/').pop(),
      description: '', body: '', files: [], origin: null,
    }))
  })

  it('renders three grouped sections with per-kind counts when expanded', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('mixed-plugin'))
    fireEvent.click(screen.getByRole('button', { name: /mixed-plugin/i }))
    expect(screen.getByText(/Skills \(1\)/)).toBeTruthy()
    expect(screen.getByText(/Sub-agents \(1\)/)).toBeTruthy()
    expect(screen.getByText(/Slash commands \(1\)/)).toBeTruthy()
  })

  it('the plugin row count badge sums all three kinds', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('mixed-plugin'))
    expect(screen.getByText(/3 items/)).toBeTruthy()
  })

  it('import dispatches readTargetFromDisk per kind for each selected target', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('mixed-plugin'))
    fireEvent.click(screen.getByRole('button', { name: /mixed-plugin/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 3 items/i }))
    await waitFor(() => expect(window.api.agents.import.readTargetFromDisk).toHaveBeenCalledTimes(3))
    const calls = (window.api.agents.import.readTargetFromDisk as any).mock.calls
    const kinds = calls.map((c: unknown[]) => c[1])
    expect(kinds).toContain('skill')
    expect(kinds).toContain('subagent')
    expect(kinds).toContain('slashCommand')
    await waitFor(() => expect(window.api.agents.import.importTarget).toHaveBeenCalledTimes(3))
  })

  it('toggling one kind off does not affect the others (kind:path keying)', async () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('mixed-plugin'))
    fireEvent.click(screen.getByRole('button', { name: /mixed-plugin/i }))
    // Default-selected: 3 items. Uncheck just the skill.
    const skillCheckboxes = screen.getAllByRole('checkbox')
    // First checkbox is the skill row (skills group renders first).
    fireEvent.click(skillCheckboxes[0])
    expect(screen.getByRole('button', { name: /import 2 items/i })).toBeTruthy()
  })

  it('renders the sync-surface subtitle', () => {
    render(<ImportPluginDialog open onClose={() => {}} />)
    expect(screen.getByText(/~\/\.claude\/agents/)).toBeTruthy()
    expect(screen.getByText(/~\/\.claude\/commands/)).toBeTruthy()
  })
})
