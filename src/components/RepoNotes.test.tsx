import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RepoNotes from './RepoNotes'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockPull = vi.fn()
const mockGetStatus = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = {
    notes: { get: mockGet, set: mockSet, pullFromGitHub: mockPull },
    skillSync: { getStatus: mockGetStatus },
  }
  mockGetStatus.mockResolvedValue({ enabled: false })
  mockGet.mockResolvedValue(null)
  mockPull.mockResolvedValue({ ok: true, action: 'no-remote' })
  mockSet.mockResolvedValue({ ok: true })
})

describe('RepoNotes', () => {
  it('shows empty-state placeholder when no notes exist', async () => {
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('12345'))
    expect(screen.getByText(/Click to add notes/i)).toBeInTheDocument()
  })

  it('renders markdown in preview when notes exist', async () => {
    mockGet.mockResolvedValue({ notes: '**bold text**', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(screen.getByText('bold text')).toBeInTheDocument())
    // <strong> is not a recognised ARIA role in this version of @testing-library;
    // verify the element exists via DOM query instead
    expect(document.querySelector('strong')).toBeInTheDocument()
  })

  it('switches to textarea when preview is clicked', async () => {
    mockGet.mockResolvedValue({ notes: 'hello world', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    const preview = await screen.findByText('hello world')
    await userEvent.click(preview)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('switches to textarea when empty-state placeholder is clicked', async () => {
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    const placeholder = await screen.findByText(/Click to add notes/i)
    await userEvent.click(placeholder)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls pullFromGitHub on mount when sync enabled AND note row exists', async () => {
    mockGetStatus.mockResolvedValue({ enabled: true })
    mockGet.mockResolvedValue({ notes: 'hi', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockPull).toHaveBeenCalledWith('12345', 'facebook', 'react'))
  })

  it('does NOT call pullFromGitHub when sync is disabled', async () => {
    mockGetStatus.mockResolvedValue({ enabled: false })
    mockGet.mockResolvedValue({ notes: 'hi', updated_at: 1000 })
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(mockPull).not.toHaveBeenCalled()
  })

  it('does NOT call pullFromGitHub when no note row exists', async () => {
    mockGetStatus.mockResolvedValue({ enabled: true })
    mockGet.mockResolvedValue(null)
    render(<RepoNotes repoId="12345" owner="facebook" repoName="react" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(mockPull).not.toHaveBeenCalled()
  })
})
