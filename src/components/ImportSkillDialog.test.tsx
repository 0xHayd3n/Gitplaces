// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportSkillDialog from './ImportSkillDialog'

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      getAll: vi.fn().mockResolvedValue({ folders: [], agents: [] }),
      createFolder: vi.fn().mockResolvedValue({ id: 'newFolder', name: 'superpowers', color_start: null, color_end: null, description: null, emoji: null, created_at: 't' }),
      import: {
        discoverPlugins: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'superpowers', version: '5.1.0', root: '/p1', skills: [
            { name: 'brainstorming', path: '/p1/skills/brainstorming', description: 'Brainstorm things', fileCount: 4 },
            { name: 'writing-plans', path: '/p1/skills/writing-plans', description: 'Plan things', fileCount: 2 },
          ]},
          { id: 'p2', name: 'anatomy', version: null, root: '/p2', skills: [
            { name: 'foo', path: '/p2/skills/foo', description: null, fileCount: 1 },
          ]},
        ]),
        readSkillFromDisk: vi.fn().mockImplementation(async (p: string) => ({
          name: p.split('/').pop(), handle: p.split('/').pop(), description: '', body: '', files: [], origin: null,
        })),
        importSkill: vi.fn().mockResolvedValue({ agentId: 'new', conflictResolved: 'created' }),
        discoverInRepo: vi.fn().mockResolvedValue({
          owner: 'obra', name: 'superpowers', branch: 'main', commitSha: 'a1b2c3d4567',
          layout: 'skills-dir',
          skills: [
            { name: 'brainstorming', path: 'skills/brainstorming', description: 'Brainstorm', fileCount: 3 },
            { name: 'plan-writing',  path: 'skills/plan-writing',  description: 'Plan',       fileCount: 2 },
          ],
        }),
        readSkillFromRepo: vi.fn().mockImplementation(async (
          owner: string, name: string, _branch: string, sha: string, repoPath: string,
        ) => ({
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

describe('ImportSkillDialog', () => {
  it('lists discovered plugins on open', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    expect(screen.getByText('superpowers')).toBeTruthy()
    expect(screen.getByText('anatomy')).toBeTruthy()
    expect(screen.getByText(/v5\.1\.0/)).toBeTruthy()
    expect(screen.getByText(/2 skills/)).toBeTruthy()
    expect(screen.getByText(/1 skill$/)).toBeTruthy()
  })

  it('clicking a plugin expands its skill list', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    expect(screen.getByText('brainstorming')).toBeTruthy()
    expect(screen.getByText('writing-plans')).toBeTruthy()
  })

  it('importing a plugin reads each selected skill and calls importSkill', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.import.importSkill).toHaveBeenCalledTimes(2))
  })

  it('creates a folder named after the plugin when none exists', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.click(screen.getByRole('button', { name: /superpowers/i }))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('superpowers'))
  })
})

describe('ImportSkillDialog — GitHub section', () => {
  it('renders a URL input and a disabled Fetch button when URL is empty', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    const input = screen.getByPlaceholderText(/owner\/repo/i)
    expect(input).toBeTruthy()
    const fetchBtn = screen.getByRole('button', { name: /^fetch$/i })
    expect((fetchBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Fetch when the URL is valid', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    expect((screen.getByRole('button', { name: /^fetch$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an inline parse error for an invalid URL', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'not-a-valid-url' } })
    expect(screen.getByText(/not a valid github url/i)).toBeTruthy()
  })

  it('on Fetch, calls discoverInRepo and renders the skill list', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => expect(window.api.agents.import.discoverInRepo).toHaveBeenCalledWith('obra/superpowers'))
    await waitFor(() => screen.getByText('plan-writing'))
    expect(screen.getByText('brainstorming')).toBeTruthy()
  })

  it('shows "No skills found" when discoverInRepo returns empty skills', async () => {
    ;(window.api.agents.import.discoverInRepo as any) = vi.fn().mockResolvedValue({
      owner: 'o', name: 'r', branch: 'main', commitSha: 'sha', layout: 'skills-dir', skills: [],
    })
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'o/r' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/no skills found/i))
  })

  it('shows an error message when discoverInRepo rejects', async () => {
    ;(window.api.agents.import.discoverInRepo as any) = vi.fn().mockRejectedValue(new Error("Couldn't load priv/repo"))
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'priv/repo' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/couldn't load/i))
  })

  it('Import calls readSkillFromRepo + importSkill for each selected skill', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.import.readSkillFromRepo).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(window.api.agents.import.importSkill).toHaveBeenCalledTimes(2))
  })

  it('creates a folder named after the repo on import', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('superpowers'))
  })
})
