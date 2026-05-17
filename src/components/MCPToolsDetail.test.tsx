import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileOverlayProvider } from '../contexts/ProfileOverlay'
import MCPToolsDetail from './MCPToolsDetail'
import type { LibraryRow } from '../types/repo'
import type { McpScanResult } from '../types/mcp'

const mockRow: LibraryRow = {
  id: 'r1', owner: 'modelcontextprotocol', name: 'server-github', language: 'TypeScript',
  description: 'GitHub MCP server',
  topics: '[]', stars: null, forks: null, license: 'MIT',
  homepage: null, updated_at: null, pushed_at: null, saved_at: '2026-01-01',
  type: 'skill', banner_svg: null, discovered_at: null, discover_query: null,
  watchers: null, size: null, open_issues: null, starred_at: null,
  default_branch: null, avatar_url: null, og_image_url: null, banner_color: null,
  translated_description: null, translated_description_lang: null,
  translated_readme: null, translated_readme_lang: null, detected_language: null,
  verification_score: null, verification_tier: null, verification_signals: null, verification_checked_at: null,
  type_bucket: 'utilities', type_sub: 'mcp-server',
  active: 1, version: 'v1.0', generated_at: '2026-01-01T00:00:00.000Z',
  enabled_components: null, enabled_tools: null, tier: 1, installed: 1,
  unstarred_at: null, is_forked: null, update_available: null,
  update_checked_at: null, upstream_version: null, stored_version: null,
}

const staticScan: McpScanResult = {
  source: 'static', detectedAt: '2026-01-01T00:00:00.000Z',
  tools: [
    { name: 'create_issue', description: 'Create an issue', category: 'github', paramSchema: null, source: 'static' },
    { name: 'close_issue',  description: 'Close an issue',  category: 'github', paramSchema: null, source: 'static' },
  ],
}

const readmeScan: McpScanResult = { ...staticScan, source: 'readme-approx', tools: staticScan.tools.map(t => ({ ...t, source: 'readme-approx' })) }

function renderDetail(props: Partial<React.ComponentProps<typeof MCPToolsDetail>> = {}) {
  const defaults = {
    row: mockRow,
    collections: [],
    activeTab: 'tools' as const,
    onTabChange: () => {},
    toolSearch: '',
    onToolSearchChange: () => {},
    scanResult: staticScan,
    onRescan: () => {},
    onToggleTool: () => {},
    onSelectAll: () => {},
    onRebuild: () => {},
    onToggleActive: () => {},
    onEnhance: () => {},
    regenerating: false,
    mcpToolsSubSkill: null,
    versionedInstalls: [],
  }
  return render(
    <MemoryRouter>
      <ProfileOverlayProvider>
        <MCPToolsDetail {...defaults} {...props} />
      </ProfileOverlayProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('api', {
    skill: {
      getContent: vi.fn().mockResolvedValue({ content: '# server-github\nskill body' }),
    },
  })
})

describe('MCPToolsDetail', () => {
  it('renders tool names and descriptions on tools tab', () => {
    renderDetail()
    expect(screen.getByText('create_issue')).toBeInTheDocument()
    expect(screen.getByText('Create an issue')).toBeInTheDocument()
    expect(screen.getByText('close_issue')).toBeInTheDocument()
  })

  it('renders MCP server type pill', () => {
    renderDetail()
    expect(screen.getByText(/MCP server/i)).toBeInTheDocument()
  })

  it('omits warning banner when scan source is static', () => {
    renderDetail()
    expect(screen.queryByText(/extracted from README/i)).not.toBeInTheDocument()
  })

  it('shows warning banner when scan source is readme-approx', () => {
    renderDetail({ scanResult: readmeScan })
    expect(screen.getByText(/extracted from README/i)).toBeInTheDocument()
  })

  it('invokes onRebuild when Rebuild button clicked', async () => {
    const user = userEvent.setup()
    const onRebuild = vi.fn()
    renderDetail({ onRebuild })
    await user.click(screen.getByRole('button', { name: /Rebuild skill/i }))
    expect(onRebuild).toHaveBeenCalled()
  })

  it('invokes onToggleTool when a tool card clicked', async () => {
    const user = userEvent.setup()
    const onToggleTool = vi.fn()
    renderDetail({ onToggleTool })
    await user.click(screen.getByText('create_issue'))
    expect(onToggleTool).toHaveBeenCalledWith('create_issue')
  })

  it('invokes onSelectAll', async () => {
    const user = userEvent.setup()
    const onSelectAll = vi.fn()
    renderDetail({ onSelectAll })
    await user.click(screen.getByRole('button', { name: /Select all/i }))
    expect(onSelectAll).toHaveBeenCalled()
  })

  it('filters tools by toolSearch', () => {
    renderDetail({ toolSearch: 'close' })
    expect(screen.queryByText('create_issue')).not.toBeInTheDocument()
    expect(screen.getByText('close_issue')).toBeInTheDocument()
  })

  it('switches to skill tab', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    renderDetail({ onTabChange })
    await user.click(screen.getByRole('button', { name: 'Skill file' }))
    expect(onTabChange).toHaveBeenCalledWith('skill')
  })

  it('renders "not scanned yet" when scanResult is null', () => {
    renderDetail({ scanResult: null })
    expect(screen.getByRole('button', { name: /Scan tools/i })).toBeInTheDocument()
  })
})
