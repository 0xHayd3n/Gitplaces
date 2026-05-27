import { describe, it, expect } from 'vitest'
import { rankAgents } from './agentRanking'
import type { AgentRow } from '../types/agent'

function mkAgent(partial: Partial<AgentRow>): AgentRow {
  return {
    id: 'id', name: 'n', handle: 'h', folder_id: null,
    color_start: null, color_end: null, emoji: null,
    pinned: 0, pinned_at: null, last_used_at: null,
    presets_json: '[]', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', description: '',
    origin_plugin: null, origin_path: null, origin_version: null,
    origin_imported_at: null, tools: null, model: 'inherit',
    model_provider: 'anthropic', model_endpoint_id: null,
    is_subagent: 0, is_slash_command: 0, argument_hint: null,
    synced_subagent_at: null, synced_slash_command_at: null,
    ...partial,
  }
}

describe('rankAgents', () => {
  it('returns pinned first (newest pinned_at first), then recent, then unused', () => {
    const pinnedOld = mkAgent({ id: 'p1', pinned: 1, pinned_at: '2026-01-01T00:00:00Z' })
    const pinnedNew = mkAgent({ id: 'p2', pinned: 1, pinned_at: '2026-02-01T00:00:00Z' })
    const recent    = mkAgent({ id: 'r1', last_used_at: '2026-03-01T00:00:00Z' })
    const recentOld = mkAgent({ id: 'r2', last_used_at: '2026-01-15T00:00:00Z' })
    const unused    = mkAgent({ id: 'u1', created_at: '2026-04-01T00:00:00Z' })

    const result = rankAgents([recent, unused, pinnedOld, pinnedNew, recentOld])

    expect(result.map(a => a.id)).toEqual(['p2', 'p1', 'r1', 'r2', 'u1'])
  })

  it('treats pinned-and-recently-used as pinned only (no double tier)', () => {
    const both = mkAgent({ id: 'b1', pinned: 1, pinned_at: '2026-02-01T00:00:00Z', last_used_at: '2026-03-01T00:00:00Z' })
    const recent = mkAgent({ id: 'r1', last_used_at: '2026-03-15T00:00:00Z' })

    const result = rankAgents([recent, both])

    expect(result.map(a => a.id)).toEqual(['b1', 'r1'])
  })

  it('caps the list at 60 items', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      mkAgent({ id: `id-${i}`, created_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }))

    const result = rankAgents(many)

    expect(result).toHaveLength(60)
  })

  it('handles empty input', () => {
    expect(rankAgents([])).toEqual([])
  })
})
