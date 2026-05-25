// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AgentFilesTab from './AgentFilesTab'
import type { AgentRow, AgentFile } from '../types/agent'

const agent: AgentRow = {
  id: 'a1',
  name: 'Test',
  handle: 'test',
  body: '# Main\n\nSee notes.md',
  folder_id: null,
  color_start: '#10b981',
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
}

const files: AgentFile[] = [
  { id: 'f1', agent_id: 'a1', filename: 'notes.md', content: '# Notes', sort_order: 0, created_at: 't', updated_at: 't' },
  { id: 'f2', agent_id: 'a1', filename: 'scripts/run.sh', content: '#!/bin/bash', sort_order: 1, created_at: 't', updated_at: 't' },
]

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      update: vi.fn().mockResolvedValue(undefined),
      files: {
        list: vi.fn().mockResolvedValue(files),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
  }
})

describe('AgentFilesTab', () => {
  it('renders the main SKILL.md entry plus the sibling files', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /SKILL\.md/ }))
    expect(screen.getByRole('button', { name: /SKILL\.md/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^notes\.md$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /scripts\/run\.sh/ })).toBeTruthy()
  })

  it('groups files into Main / References / Scripts sections', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /SKILL\.md/ }))
    expect(screen.getByText(/^Main$/i)).toBeTruthy()
    expect(screen.getByText(/^References$/i)).toBeTruthy()
    expect(screen.getByText(/^Scripts$/i)).toBeTruthy()
  })

  it('selecting SKILL.md shows the agent.body in the editor', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /SKILL\.md/ }))
    // SKILL.md is the default active selection on mount; the editor should already show the body
    const editor = screen.getByRole('textbox', { name: /file content/i }) as HTMLTextAreaElement
    expect(editor.value).toContain('# Main')
  })

  it('editing the main file calls api.agents.update with new body', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /SKILL\.md/ }))
    const editor = screen.getByRole('textbox', { name: /file content/i })
    fireEvent.change(editor, { target: { value: 'changed body' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(window.api.agents.update).toHaveBeenCalledWith('a1', { body: 'changed body' }))
  })

  it('selecting a sibling file shows its content and edits call files.update', async () => {
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /^notes\.md$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^notes\.md$/ }))
    const editor = screen.getByRole('textbox', { name: /file content/i }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toBe('# Notes'))
    fireEvent.change(editor, { target: { value: 'new content' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(window.api.agents.files.update).toHaveBeenCalledWith('a1', 'f1', { content: 'new content' }))
  })

  it('Add file button creates a new empty file', async () => {
    const created: AgentFile = { id: 'f3', agent_id: 'a1', filename: 'new.md', content: '', sort_order: 2, created_at: 't', updated_at: 't' }
    ;(window as any).api.agents.files.create = vi.fn().mockResolvedValue(created)
    ;(window as any).api.agents.files.list = vi.fn()
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce([...files, created])
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new.md')
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /SKILL\.md/ }))
    fireEvent.click(screen.getByRole('button', { name: /add file/i }))
    await waitFor(() => expect(window.api.agents.files.create).toHaveBeenCalledWith('a1', expect.objectContaining({ filename: 'new.md' })))
    promptSpy.mockRestore()
  })

  it('Delete button confirms and calls files.delete for the active sibling', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AgentFilesTab agent={agent} />)
    await waitFor(() => screen.getByRole('button', { name: /^notes\.md$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^notes\.md$/ }))
    fireEvent.click(screen.getByRole('button', { name: /delete file/i }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(window.api.agents.files.delete).toHaveBeenCalledWith('a1', 'f1'))
    confirmSpy.mockRestore()
  })

})
