import type { AgentRow } from '../types/agent'

const MAX_RANKED = 60

/**
 * Three-tier ranking for the Discover Agents row and tab:
 *   1. Pinned (pinned === 1), newest pinned_at first.
 *   2. Recently used (last_used_at !== null, not pinned), newest first.
 *   3. Unused (last_used_at === null, not pinned), newest created_at first.
 *
 * Tiers are disjoint by construction; the final list is capped at 60 to
 * keep both the horizontal row carousel and the vertical grid bounded
 * without paginating.
 */
export function rankAgents(agents: AgentRow[]): AgentRow[] {
  const pinned: AgentRow[] = []
  const recent: AgentRow[] = []
  const unused: AgentRow[] = []

  for (const a of agents) {
    if (a.pinned === 1) pinned.push(a)
    else if (a.last_used_at !== null) recent.push(a)
    else unused.push(a)
  }

  pinned.sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''))
  recent.sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''))
  unused.sort((a, b) => b.created_at.localeCompare(a.created_at))

  return [...pinned, ...recent, ...unused].slice(0, MAX_RANKED)
}
