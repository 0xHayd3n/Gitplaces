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
