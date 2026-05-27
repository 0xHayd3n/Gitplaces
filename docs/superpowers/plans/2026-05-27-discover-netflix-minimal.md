# Discover Netflix-minimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Discover view as a Netflix-style minimal shell — single horizontal pill-bar nav (search + Home / Recommended / Agents tabs), Home as pure carousel rows, removable filter chips above grid views, and a new Agents tab driven by the user's local prompt library.

**Architecture:** Replace the centered logo+search+filter top nav with a horizontal pill bar that swaps tabs ↔ search input inline. Move hero badges inline between description and owner. Generalise `DiscoverRow` to host either repo or agent cards. Move filter UI out of the nav into a chip row above the grid with a `+ Filter` overlay that wraps the existing `FilterPanel` / `AdvancedPanel`. Add a new `AgentCard` + ranking helper that consumes `window.api.agents.getAll()` — no new backend.

**Tech Stack:** React 18 + TypeScript, React Router, Vitest + React Testing Library, Electron IPC for data (`window.api.agents`), CSS Modules / globals.

**Spec:** `docs/superpowers/specs/2026-05-27-discover-netflix-minimal-design.md`

---

## File map

### New files
| Path                                         | Responsibility                                     |
|----------------------------------------------|----------------------------------------------------|
| `src/lib/agentRanking.ts`                    | Pure `rankAgents()` — pinned → recent → unused, cap 60 |
| `src/lib/agentRanking.test.ts`               | Unit tests for ranking + cap                       |
| `src/components/AgentCard.tsx`               | Agent grid card — swatch + emoji + name + handle + pills + desc |
| `src/components/AgentCard.css`               | Agent card styles                                   |
| `src/components/AgentCard.test.tsx`          | Render + navigation tests                          |
| `src/components/DiscoverRowRepoCard.tsx`     | Repo carousel-item extracted from `DiscoverRow`     |
| `src/components/DiscoverRowAgentCard.tsx`    | Agent carousel-item (parallel to `DiscoverRowRepoCard`) |
| `src/components/FilterChipRow.tsx`           | Active-filter chips + `+ Filter` button             |
| `src/components/FilterChipRow.css`           | Chip row styles                                     |
| `src/components/FilterChipRow.test.tsx`      | Chip render / clear / overlay-open tests           |
| `src/components/FilterOverlay.tsx`           | Popover hosting existing `FilterPanel` / `AdvancedPanel` |
| `src/components/FilterOverlay.css`           | Overlay styles                                      |
| `src/components/FilterOverlay.test.tsx`      | Outside-click / Esc / tab-switch tests             |

### Modified files
| Path                                         | Change                                              |
|----------------------------------------------|-----------------------------------------------------|
| `src/lib/discoverQueries.ts`                 | Drop `'last-visited'` from `ViewModeKey`, add `'agents'`. Default key becomes `'home'`. |
| `src/components/DiscoverRow.tsx`             | Extract `DiscoverRowCardItem`; add generic `renderCard` prop |
| `src/components/DiscoverHero.tsx`            | Move badges into `.discover-hero-text` between desc and owner |
| `src/components/DiscoverHero.css`            | Drop right-side badge column, restyle badges as inline full pills |
| `src/components/DiscoverHero.test.tsx`       | Assert badges render between desc and owner         |
| `src/components/DiscoverTopNav.tsx`          | Rewrite as Netflix pill bar (tabs ↔ search inline) |
| `src/components/DiscoverTopNav.css`          | Pill-bar styles; drop `dtn-brand-*` and filter button |
| `src/components/DiscoverTopNav.test.tsx`     | Rewrite against new pill-bar contract              |
| `src/components/DiscoverGrid.tsx`            | Branch on `viewMode === 'agents'` to render `AgentCard` |
| `src/views/Discover.tsx`                     | Replace `GridHeader` with `FilterChipRow`; Most Popular becomes a row; add Agents view; snapshot normalise dropped view modes |

---

## Task 1: Agent ranking

**Files:**
- Create: `src/lib/agentRanking.ts`
- Test: `src/lib/agentRanking.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agentRanking.test.ts`:

```typescript
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

    // Pinned comes first regardless of last_used_at on the recent agent
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/agentRanking.test.ts`
Expected: FAIL — `Cannot find module './agentRanking'`

- [ ] **Step 3: Implement `rankAgents`**

Create `src/lib/agentRanking.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/agentRanking.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentRanking.ts src/lib/agentRanking.test.ts
git commit -m "feat(discover): rankAgents helper for Agents row + tab"
```

---

## Task 2: AgentCard component

**Files:**
- Create: `src/components/AgentCard.tsx`
- Create: `src/components/AgentCard.css`
- Test: `src/components/AgentCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AgentCard from './AgentCard'
import type { AgentRow } from '../types/agent'

function mkAgent(partial: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1', name: 'Brainstorm', handle: 'brainstorm', folder_id: null,
    color_start: '#6366f1', color_end: '#a855f7', emoji: '🧠',
    pinned: 0, pinned_at: null, last_used_at: null,
    presets_json: '[]', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', description: 'Turn ideas into specs.',
    origin_plugin: null, origin_path: null, origin_version: null,
    origin_imported_at: null, tools: null, model: 'inherit',
    model_provider: 'anthropic', model_endpoint_id: null,
    is_subagent: 0, is_slash_command: 0, argument_hint: null,
    synced_subagent_at: null, synced_slash_command_at: null,
    ...partial,
  }
}

function renderCard(agent: AgentRow) {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<AgentCard agent={agent} />} />
        <Route path="/library/agent/:id" element={<div>agent detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AgentCard', () => {
  it('renders name, handle, description and emoji', () => {
    renderCard(mkAgent())
    expect(screen.getByText('Brainstorm')).toBeTruthy()
    expect(screen.getByText('@brainstorm')).toBeTruthy()
    expect(screen.getByText('Turn ideas into specs.')).toBeTruthy()
    expect(screen.getByText('🧠')).toBeTruthy()
  })

  it('renders Subagent and Slash Command pills when flags are set', () => {
    renderCard(mkAgent({ is_subagent: 1, is_slash_command: 1 }))
    expect(screen.getByText('Subagent')).toBeTruthy()
    expect(screen.getByText('Slash Command')).toBeTruthy()
  })

  it('omits pills when flags are 0', () => {
    renderCard(mkAgent({ is_subagent: 0, is_slash_command: 0 }))
    expect(screen.queryByText('Subagent')).toBeNull()
    expect(screen.queryByText('Slash Command')).toBeNull()
  })

  it('applies the gradient swatch when color_end is set', () => {
    renderCard(mkAgent({ color_start: '#6366f1', color_end: '#a855f7' }))
    const swatch = screen.getByTestId('agent-card-swatch')
    expect((swatch as HTMLElement).style.background).toContain('linear-gradient')
  })

  it('falls back to solid swatch when color_end is null', () => {
    renderCard(mkAgent({ color_start: '#6366f1', color_end: null }))
    const swatch = screen.getByTestId('agent-card-swatch')
    expect((swatch as HTMLElement).style.background).not.toContain('linear-gradient')
  })

  it('navigates to /library/agent/:id on click', () => {
    renderCard(mkAgent({ id: 'xyz' }))
    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/i }))
    expect(screen.getByText('agent detail')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/AgentCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `AgentCard`**

Create `src/components/AgentCard.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import type { AgentRow } from '../types/agent'
import './AgentCard.css'

interface AgentCardProps {
  agent: AgentRow
  focused?: boolean
}

export default function AgentCard({ agent, focused }: AgentCardProps) {
  const navigate = useNavigate()

  const background = agent.color_end
    ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
    : (agent.color_start ?? '#888')

  return (
    <button
      type="button"
      className={`agent-card${focused ? ' kb-focused' : ''}${agent.pinned === 1 ? ' agent-card-pinned' : ''}`}
      onClick={() => navigate(`/library/agent/${agent.id}`)}
      aria-label={agent.name}
    >
      <div
        className="agent-card-swatch"
        data-testid="agent-card-swatch"
        style={{ background }}
      >
        <span className="agent-card-swatch-emoji">{agent.emoji ?? ''}</span>
      </div>
      <div className="agent-card-body">
        <div className="agent-card-title-block">
          <div className="agent-card-title">{agent.name}</div>
          <span className="agent-card-handle">@{agent.handle}</span>
        </div>
        <div className="agent-card-pill-row">
          {agent.is_subagent === 1 && (
            <span className="agent-card-pill">Subagent</span>
          )}
          {agent.is_slash_command === 1 && (
            <span className="agent-card-pill">Slash Command</span>
          )}
        </div>
        {agent.description && (
          <p className="agent-card-description">{agent.description}</p>
        )}
      </div>
    </button>
  )
}
```

Create `src/components/AgentCard.css`:

```css
/* ── Agent Card ────────────────────────────────────────────────── */

.agent-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  font-family: inherit;
  color: inherit;
  transition: transform 0.15s ease, border-color 0.2s ease, background 0.2s ease;
}

.agent-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.7);
}

.agent-card-pinned {
  border-color: rgba(245, 158, 11, 0.35);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.15), inset 0 0 12px rgba(245, 158, 11, 0.04);
}

.agent-card.kb-focused {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.agent-card-swatch {
  position: relative;
  height: 80px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-card-swatch-emoji {
  font-size: 32px;
  line-height: 1;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}

.agent-card-body {
  padding: 12px 14px 14px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.agent-card:hover .agent-card-body {
  background: rgba(0, 0, 0, 0.88);
}

.agent-card-title-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.agent-card-title {
  font-size: 18px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.25;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card-title::first-letter { text-transform: uppercase; }

.agent-card-handle {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-card-pill-row {
  min-height: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.agent-card-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(139, 92, 246, 0.35);
  border: 1px solid rgba(139, 92, 246, 0.55);
}

.agent-card-description {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: break-word;
  margin: 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/AgentCard.test.tsx`
Expected: PASS — 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentCard.tsx src/components/AgentCard.css src/components/AgentCard.test.tsx
git commit -m "feat(discover): AgentCard component for Agents row + tab"
```

---

## Task 3: Generalise DiscoverRow

**Goal:** Let `DiscoverRow` host either repo cards or agent cards via a `renderCard` prop. Extract the existing inline `DiscoverRowCardItem` into its own file.

**Files:**
- Create: `src/components/DiscoverRowRepoCard.tsx`
- Create: `src/components/DiscoverRowAgentCard.tsx`
- Modify: `src/components/DiscoverRow.tsx`

- [ ] **Step 1: Extract `DiscoverRowCardItem` from `DiscoverRow.tsx` into `DiscoverRowRepoCard.tsx`**

Create `src/components/DiscoverRowRepoCard.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import { type RepoRow } from '../types/repo'

const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦',
  star:'⭐', sparkles:'✨', heart:'❤️', brain:'🧠', robot:'🤖',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

export interface DiscoverRowRepoCardProps {
  repo: RepoRow
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
  onLanguageClick?: (lang: string) => void
}

export default function DiscoverRowRepoCard({
  repo, posIndex, columns, visible, onNavigate, onLanguageClick,
}: DiscoverRowRepoCardProps) {
  const [desc, setDesc] = useState<string | null>(() => {
    if (repo.detected_language && repo.detected_language !== 'en' && repo.translated_description) {
      return repo.translated_description
    }
    return repo.description
  })

  useEffect(() => {
    setDesc(() => {
      if (repo.detected_language && repo.detected_language !== 'en' && repo.translated_description) {
        return repo.translated_description
      }
      return repo.description
    })
    if (!repo.description || repo.description.length < 6) return
    async function maybeTranslate() {
      try {
        const preferredLang = await window.api.settings.getPreferredLanguage().catch(() => 'en')
        if (repo.translated_description && repo.translated_description_lang === preferredLang) {
          setDesc(repo.translated_description)
          return
        }
        const scriptLang = await window.api.translate.check(repo.description!, preferredLang, 6).catch(() => null)
        if (!scriptLang) return
        const result = await window.api.translate.translate(repo.description!, preferredLang).catch(() => null)
        if (!result) return
        setDesc(result.translatedText)
        if (repo.id) {
          window.api.db.cacheTranslatedDescription(repo.id, result.translatedText, preferredLang, scriptLang).catch(() => {})
        }
      } catch { /* non-critical */ }
    }
    maybeTranslate()
  }, [repo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(repo.type_sub)
  const pillAccent = typeConfig?.accentColor ?? (repo.type_bucket ? getBucketColor(repo.type_bucket) : null)
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(repo.type_bucket))
  const isPeek = posIndex < 0 || posIndex >= visible
  const isActive = posIndex === 0
  const GAP = 16
  const cardWidth = `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`
  const cardLeft = posIndex === 0
    ? '0px'
    : `calc(${posIndex} * (100% + ${GAP}px))`

  const parsedDescription = useMemo(() => parseEmoji(desc ?? ''), [desc])

  return (
    <button
      key={repo.id}
      className={`discover-row-card${isPeek ? ' discover-row-card--peek' : isActive ? ' discover-row-card--p0' : ''}${repo.starred_at ? ' discover-row-card--starred' : ''}`}
      style={{ width: cardWidth, transform: `translateX(${cardLeft})` } as React.CSSProperties}
      onClick={!isPeek ? () => onNavigate(`/repo/${repo.owner}/${repo.name}`) : undefined}
      aria-label={`${repo.owner}/${repo.name}`}
      tabIndex={isPeek ? -1 : undefined}
      aria-hidden={isPeek}
    >
      <div className="repo-card-image">
        <DitherBackground avatarUrl={repo.avatar_url} fallbackGradient={gradient} />
        {repo.language && (
          <span
            className="repo-card-lang-overlay"
            onClick={e => { e.stopPropagation(); onLanguageClick?.(repo.language!) }}
            title={repo.language}
          >
            <LanguageIcon lang={repo.language} size={26} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{repo.name}</div>
          <span className="repo-card-author">by {repo.owner}</span>
        </div>
        <div className="repo-card-pill-row">
          {typeConfig && pillAccent && repo.type_sub && (
            <span
              className="repo-card-pill"
              style={{ '--pill-accent': pillAccent } as React.CSSProperties}
            >
              {typeConfig.icon && (
                <span className="repo-card-pill-icon">
                  <typeConfig.icon size={10} fill="currentColor" />
                </span>
              )}
              {typeConfig.label}
            </span>
          )}
        </div>
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Create `DiscoverRowAgentCard.tsx`**

Create `src/components/DiscoverRowAgentCard.tsx`:

```tsx
import type { AgentRow } from '../types/agent'

export interface DiscoverRowAgentCardProps {
  agent: AgentRow
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
}

export default function DiscoverRowAgentCard({
  agent, posIndex, columns, visible, onNavigate,
}: DiscoverRowAgentCardProps) {
  const isPeek = posIndex < 0 || posIndex >= visible
  const isActive = posIndex === 0
  const GAP = 16
  const cardWidth = `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`
  const cardLeft = posIndex === 0
    ? '0px'
    : `calc(${posIndex} * (100% + ${GAP}px))`

  const background = agent.color_end
    ? `linear-gradient(135deg, ${agent.color_start ?? '#888'}, ${agent.color_end})`
    : (agent.color_start ?? '#888')

  return (
    <button
      key={agent.id}
      className={`discover-row-card${isPeek ? ' discover-row-card--peek' : isActive ? ' discover-row-card--p0' : ''}${agent.pinned === 1 ? ' discover-row-card--starred' : ''}`}
      style={{ width: cardWidth, transform: `translateX(${cardLeft})` } as React.CSSProperties}
      onClick={!isPeek ? () => onNavigate(`/library/agent/${agent.id}`) : undefined}
      aria-label={agent.name}
      tabIndex={isPeek ? -1 : undefined}
      aria-hidden={isPeek}
    >
      <div className="repo-card-image" style={{ background }}>
        <span style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
        }}>{agent.emoji ?? ''}</span>
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{agent.name}</div>
          <span className="repo-card-author">@{agent.handle}</span>
        </div>
        <div className="repo-card-pill-row">
          {agent.is_subagent === 1 && <span className="repo-card-pill">Subagent</span>}
          {agent.is_slash_command === 1 && <span className="repo-card-pill">Slash Command</span>}
        </div>
        {agent.description && (
          <p className="repo-card-description">{agent.description}</p>
        )}
      </div>
    </button>
  )
}
```

- [ ] **Step 3: Modify `DiscoverRow.tsx` to use a `renderCard` prop**

Replace the entire contents of `src/components/DiscoverRow.tsx` with:

```tsx
import { type ReactNode } from 'react'
import './DiscoverRow.css'

interface DiscoverRowSlot<T> {
  item: T
  posIndex: number
}

interface DiscoverRowProps<T> {
  items: T[]
  activeIndex: number
  columns: number
  getItemKey: (item: T) => string
  renderCard: (slot: DiscoverRowSlot<T> & { columns: number; visible: number }) => ReactNode
  onAdvance: (delta: number) => void
  title?: string
  onMore?: () => void
  onPause?: (paused: boolean) => void
}

export default function DiscoverRow<T>({
  items, activeIndex, columns, getItemKey, renderCard,
  onAdvance, title = 'Recommended for You', onMore, onPause,
}: DiscoverRowProps<T>) {
  if (items.length === 0) return null

  const visible = Math.min(columns, items.length)
  const slots: DiscoverRowSlot<T>[] = Array.from({ length: visible }, (_, i) => ({
    item: items[(activeIndex + i) % items.length],
    posIndex: i,
  }))

  if (items.length > visible) {
    slots.unshift({
      item: items[(activeIndex - 1 + items.length) % items.length],
      posIndex: -1,
    })
  }
  if (items.length >= visible + 2) {
    slots.push({
      item: items[(activeIndex + visible) % items.length],
      posIndex: visible,
    })
  }

  const atStart = activeIndex === 0
  const atEnd = activeIndex >= Math.max(0, items.length - visible)

  return (
    <div className="discover-row">
      <div className="discover-row-header">
        {onMore ? (
          <button className="discover-row-title-btn" onClick={onMore} aria-label={`See all ${title}`}>
            <span>{title}</span>
            <span className="discover-row-title-chevron" aria-hidden="true">›</span>
          </button>
        ) : (
          <span className="discover-row-title-static">{title}</span>
        )}
      </div>
      <div
        className="discover-row-carousel"
        onMouseEnter={() => onPause?.(true)}
        onMouseLeave={() => onPause?.(false)}
      >
        {slots.map(({ item, posIndex }) => (
          <div key={getItemKey(item)} style={{ display: 'contents' }}>
            {renderCard({ item, posIndex, columns, visible })}
          </div>
        ))}
        <button
          className="discover-row-nav-zone discover-row-nav-zone--prev"
          onClick={() => onAdvance(-1)}
          disabled={atStart}
          aria-label="Previous"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          className="discover-row-nav-zone discover-row-nav-zone--next"
          onClick={() => onAdvance(1)}
          disabled={atEnd}
          aria-label="Next"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify the existing DiscoverRow test still passes**

Run: `npm test -- src/components/DiscoverRow.test.tsx`
Expected: FAIL — DiscoverRow now takes `items`/`renderCard` instead of `repos`. The test needs to be updated.

- [ ] **Step 5: Update `DiscoverRow.test.tsx`**

Read the existing test, then rewrite to use the new API. The simplest port: wherever the test passed `repos={...}` and expected repo cards, swap to `items={...}` + `getItemKey={r => r.id}` + `renderCard={({ item, posIndex, columns, visible }) => <DiscoverRowRepoCard repo={item} ... />}`. Run the test until it passes.

Run: `npm test -- src/components/DiscoverRow.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/DiscoverRow.tsx src/components/DiscoverRowRepoCard.tsx src/components/DiscoverRowAgentCard.tsx src/components/DiscoverRow.test.tsx
git commit -m "refactor(discover): generalise DiscoverRow with renderCard prop"
```

---

## Task 4: FilterOverlay component

**Goal:** A popover host for the existing `FilterPanel` and `AdvancedPanel`. No business logic — pure UI shell.

**Files:**
- Create: `src/components/FilterOverlay.tsx`
- Create: `src/components/FilterOverlay.css`
- Test: `src/components/FilterOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/FilterOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterOverlay from './FilterOverlay'

const baseProps = {
  open: true,
  onClose: vi.fn(),
  // Discover sidebar props pass-through (minimal stubs)
  selectedSubtypes: [],
  onSelectedSubtypesChange: vi.fn(),
  filters: {},
  selectedLanguages: [],
  activeVerification: new Set<'verified' | 'likely'>(),
  onFilterChange: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onVerificationToggle: vi.fn(),
  initialTab: 'languages' as const,
}

describe('FilterOverlay', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<FilterOverlay {...baseProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders Languages / Types / Advanced tabs', () => {
    render(<FilterOverlay {...baseProps} />)
    expect(screen.getByRole('button', { name: /languages/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /types/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /advanced/i })).toBeTruthy()
  })

  it('calls onClose when Esc is pressed', () => {
    const onClose = vi.fn()
    render(<FilterOverlay {...baseProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on outside click', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <FilterOverlay {...baseProps} onClose={onClose} />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/FilterOverlay.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `FilterOverlay`**

Create `src/components/FilterOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { FilterPanel, AdvancedPanel, type DiscoverSidebarProps } from './DiscoverSidebar'
import './FilterOverlay.css'

export interface FilterOverlayProps extends Pick<
  DiscoverSidebarProps,
  'selectedSubtypes' | 'onSelectedSubtypesChange'
  | 'filters' | 'selectedLanguages' | 'activeVerification'
  | 'onFilterChange' | 'onSelectedLanguagesChange' | 'onVerificationToggle'
  | 'mode' | 'skillStatus' | 'onSkillStatusChange' | 'itemCounts'
> {
  open: boolean
  onClose: () => void
  initialTab?: 'languages' | 'types' | 'advanced'
}

export default function FilterOverlay(props: FilterOverlayProps) {
  const { open, onClose, initialTab = 'languages', ...rest } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'languages' | 'types' | 'advanced'>(initialTab)

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  const langCount = rest.selectedLanguages.length
  const typeCount = rest.selectedSubtypes.length
  const advCount  = (rest.filters.stars ? 1 : 0)
    + (rest.filters.activity ? 1 : 0)
    + (rest.filters.license ? 1 : 0)
    + rest.activeVerification.size

  return (
    <div ref={wrapRef} className="filter-overlay" role="dialog" aria-label="Filters">
      <div className="filter-overlay-tabs">
        <button
          className={`filter-overlay-tab${tab === 'languages' ? ' active' : ''}`}
          onClick={() => setTab('languages')}
        >
          Languages
          {langCount > 0 && <span className="filter-overlay-tab-badge">{langCount}</span>}
        </button>
        <button
          className={`filter-overlay-tab${tab === 'types' ? ' active' : ''}`}
          onClick={() => setTab('types')}
        >
          Types
          {typeCount > 0 && <span className="filter-overlay-tab-badge">{typeCount}</span>}
        </button>
        <button
          className={`filter-overlay-tab${tab === 'advanced' ? ' active' : ''}`}
          onClick={() => setTab('advanced')}
        >
          Advanced
          {advCount > 0 && <span className="filter-overlay-tab-badge">{advCount}</span>}
        </button>
      </div>
      <div className="filter-overlay-body">
        {(tab === 'languages' || tab === 'types') && (
          <FilterPanel
            selectedLanguages={rest.selectedLanguages}
            onSelectedLanguagesChange={rest.onSelectedLanguagesChange}
            selectedSubtypes={rest.selectedSubtypes}
            onSelectedSubtypesChange={rest.onSelectedSubtypesChange}
            itemCounts={rest.itemCounts}
            embedded
            activeTab={tab === 'languages' ? 'language' : 'type'}
          />
        )}
        {tab === 'advanced' && (
          <AdvancedPanel
            filters={rest.filters}
            activeVerification={rest.activeVerification}
            onFilterChange={rest.onFilterChange}
            onVerificationToggle={rest.onVerificationToggle}
            mode={rest.mode}
            skillStatus={rest.skillStatus}
            onSkillStatusChange={rest.onSkillStatusChange}
          />
        )}
      </div>
    </div>
  )
}
```

> **Note:** `FilterPanel` accepts a `search` prop but no `onSearchChange` — the panel manages its own internal search state when uncontrolled. We let it own search; no local search state inside `FilterOverlay` is needed.

Create `src/components/FilterOverlay.css`:

```css
.filter-overlay {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: min(720px, calc(100vw - 40px));
  max-height: calc(100vh - 200px);
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
  z-index: 250;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filter-overlay-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 14px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.filter-overlay-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.4);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
}

.filter-overlay-tab:hover { color: rgba(255, 255, 255, 0.75); }

.filter-overlay-tab.active {
  color: var(--t1);
  border-bottom-color: rgba(255, 255, 255, 0.55);
}

.filter-overlay-tab-badge {
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.18);
  color: var(--t1);
  font-size: 8px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.filter-overlay-body {
  flex: 1;
  min-height: 0;
  overflow-y: overlay;
  overflow-x: hidden;
  padding: 0 14px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/FilterOverlay.test.tsx`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterOverlay.tsx src/components/FilterOverlay.css src/components/FilterOverlay.test.tsx
git commit -m "feat(discover): FilterOverlay popover for chip-row + Filter button"
```

---

## Task 5: FilterChipRow component

**Goal:** Renders one chip per active filter + a `+ Filter` button. Mounts `FilterOverlay` when `+ Filter` is clicked.

**Files:**
- Create: `src/components/FilterChipRow.tsx`
- Create: `src/components/FilterChipRow.css`
- Test: `src/components/FilterChipRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/FilterChipRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterChipRow from './FilterChipRow'

const baseProps = {
  selectedLanguages: [],
  selectedSubtypes: [],
  activeTags: [],
  filters: {},
  activeVerification: new Set<'verified' | 'likely'>(),
  onRemoveLanguage: vi.fn(),
  onRemoveSubtype: vi.fn(),
  onRemoveTag: vi.fn(),
  onClearAdvanced: vi.fn(),
  onVerificationToggle: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onSelectedSubtypesChange: vi.fn(),
  onFilterChange: vi.fn(),
}

describe('FilterChipRow', () => {
  it('renders nothing when no filters are active', () => {
    const { container } = render(<FilterChipRow {...baseProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one chip per active filter', () => {
    render(
      <FilterChipRow
        {...baseProps}
        selectedLanguages={['typescript']}
        selectedSubtypes={['cli-tool']}
        filters={{ stars: 1000 }}
        activeVerification={new Set(['verified'])}
      />,
    )
    expect(screen.getByText(/typescript/i)).toBeTruthy()
    expect(screen.getByText(/cli/i)).toBeTruthy()
    expect(screen.getByText(/1,?000\+/i)).toBeTruthy()
    expect(screen.getByText(/verified/i)).toBeTruthy()
  })

  it('calls onRemoveLanguage when a language chip × is clicked', () => {
    const onRemoveLanguage = vi.fn()
    render(
      <FilterChipRow {...baseProps} selectedLanguages={['python']} onRemoveLanguage={onRemoveLanguage} />,
    )
    fireEvent.click(screen.getByLabelText(/remove python/i))
    expect(onRemoveLanguage).toHaveBeenCalledWith('python')
  })

  it('opens the FilterOverlay when + Filter is clicked', () => {
    render(<FilterChipRow {...baseProps} selectedLanguages={['rust']} />)
    fireEvent.click(screen.getByRole('button', { name: /\+ Filter/i }))
    expect(screen.getByRole('dialog', { name: /filters/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/FilterChipRow.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `FilterChipRow`**

Create `src/components/FilterChipRow.tsx`:

```tsx
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { LANG_MAP } from '../lib/languages'
import { getSubTypeConfig } from '../config/repoTypeConfig'
import FilterOverlay from './FilterOverlay'
import type { SearchFilters } from './DiscoverSidebar'
import './FilterChipRow.css'

export interface FilterChipRowProps {
  selectedLanguages: string[]
  selectedSubtypes: string[]
  activeTags: string[]
  filters: SearchFilters
  activeVerification: Set<'verified' | 'likely'>

  onRemoveLanguage: (key: string) => void
  onRemoveSubtype: (id: string) => void
  onRemoveTag: (tag: string) => void
  onClearAdvanced: (key: 'stars' | 'activity' | 'license') => void
  onVerificationToggle: (tier: 'verified' | 'likely') => void

  // Pass-through for FilterOverlay's panel content
  onSelectedLanguagesChange: (keys: string[]) => void
  onSelectedSubtypesChange: (ids: string[]) => void
  onFilterChange: (filters: SearchFilters) => void
}

function langLabel(key: string): string {
  return LANG_MAP[key]?.name ?? key
}

function subtypeLabel(id: string): string {
  return getSubTypeConfig(id)?.label ?? id
}

function starsLabel(stars: number): string {
  return stars >= 1000 ? `${(stars / 1000).toFixed(0)},000+ stars` : `${stars}+ stars`
}

function activityLabel(a: 'week' | 'month' | 'halfyear'): string {
  return a === 'week' ? 'Active last 7 days' : a === 'month' ? 'Active last 30 days' : 'Active last 6 months'
}

export default function FilterChipRow(props: FilterChipRowProps) {
  const {
    selectedLanguages, selectedSubtypes, activeTags, filters, activeVerification,
    onRemoveLanguage, onRemoveSubtype, onRemoveTag, onClearAdvanced, onVerificationToggle,
    onSelectedLanguagesChange, onSelectedSubtypesChange, onFilterChange,
  } = props

  const [overlayOpen, setOverlayOpen] = useState(false)

  const hasChips =
    selectedLanguages.length > 0
    || selectedSubtypes.length > 0
    || activeTags.length > 0
    || !!filters.stars || !!filters.activity || !!filters.license
    || activeVerification.size > 0

  if (!hasChips && !overlayOpen) return null

  return (
    <div className="filter-chip-row">
      {selectedLanguages.map(key => (
        <span key={`lang-${key}`} className="filter-chip">
          {langLabel(key)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveLanguage(key)}
            aria-label={`Remove ${langLabel(key)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {selectedSubtypes.map(id => (
        <span key={`sub-${id}`} className="filter-chip">
          {subtypeLabel(id)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveSubtype(id)}
            aria-label={`Remove ${subtypeLabel(id)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {activeTags.map(tag => (
        <span key={`tag-${tag}`} className="filter-chip">
          {tag}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onRemoveTag(tag)}
            aria-label={`Remove ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {filters.stars && (
        <span className="filter-chip">
          {starsLabel(filters.stars)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('stars')}
            aria-label="Remove stars filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {filters.activity && (
        <span className="filter-chip">
          {activityLabel(filters.activity)}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('activity')}
            aria-label="Remove activity filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {filters.license && (
        <span className="filter-chip">
          {filters.license.toUpperCase()}
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onClearAdvanced('license')}
            aria-label="Remove license filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {activeVerification.has('verified') && (
        <span className="filter-chip">
          Verified
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onVerificationToggle('verified')}
            aria-label="Remove verified filter"
          >
            <X size={11} />
          </button>
        </span>
      )}
      {activeVerification.has('likely') && (
        <span className="filter-chip">
          Likely Verified
          <button
            type="button"
            className="filter-chip-x"
            onClick={() => onVerificationToggle('likely')}
            aria-label="Remove likely-verified filter"
          >
            <X size={11} />
          </button>
        </span>
      )}

      <button
        type="button"
        className="filter-chip-add"
        onClick={() => setOverlayOpen(o => !o)}
      >
        <Plus size={11} />
        <span>Filter</span>
      </button>

      <FilterOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        selectedLanguages={selectedLanguages}
        onSelectedLanguagesChange={onSelectedLanguagesChange}
        selectedSubtypes={selectedSubtypes}
        onSelectedSubtypesChange={onSelectedSubtypesChange}
        filters={filters}
        activeVerification={activeVerification}
        onFilterChange={onFilterChange}
        onVerificationToggle={onVerificationToggle}
      />
    </div>
  )
}
```

Create `src/components/FilterChipRow.css`:

```css
.filter-chip-row {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0 12px;
  align-items: center;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.filter-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  padding: 0;
}

.filter-chip-x:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--t1);
}

.filter-chip-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.filter-chip-add:hover {
  border-color: rgba(255, 255, 255, 0.4);
  color: var(--t1);
  background: rgba(255, 255, 255, 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/FilterChipRow.test.tsx`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterChipRow.tsx src/components/FilterChipRow.css src/components/FilterChipRow.test.tsx
git commit -m "feat(discover): FilterChipRow + Filter overlay launcher"
```

---

## Task 6: Move hero badges inline

**Files:**
- Modify: `src/components/DiscoverHero.tsx`
- Modify: `src/components/DiscoverHero.css`
- Modify: `src/components/DiscoverHero.test.tsx`

- [ ] **Step 1: Update test to assert new badge position**

Read existing `src/components/DiscoverHero.test.tsx` and add a new test case (keep existing ones):

```tsx
it('renders badges between description and owner inside the text column', () => {
  render(<DiscoverHero repo={{ ...repo, type_sub: 'cli-tool' }} onNavigate={vi.fn()} />)
  const text = screen.getByText(repo.description!).closest('.discover-hero-text')
  expect(text).toBeTruthy()
  // The badge container is a child of .discover-hero-text now
  expect(text!.querySelector('.discover-hero-badges')).toBeTruthy()
  // And the right-column wrapper is gone
  expect(document.querySelector('.discover-hero-content > .discover-hero-badges')).toBeNull()
})

it('renders badge labels inline (no hover-reveal)', () => {
  render(<DiscoverHero repo={{ ...repo, type_sub: 'cli-tool' }} onNavigate={vi.fn()} />)
  // Type label is always visible (no max-width:0 hover trick)
  expect(screen.getByText(/cli/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/DiscoverHero.test.tsx`
Expected: FAIL on the two new tests — badges currently render in the right column with hover-reveal labels.

- [ ] **Step 3: Edit `src/components/DiscoverHero.tsx`**

In `HeroLayer()`, move the badges JSX inside `.discover-hero-text`, between description and owner. Replace the existing return so the JSX block reads:

```tsx
return (
  <div className={`discover-hero-layer ${animClass}`}>
    <DitherBackground avatarUrl={repo.avatar_url} />
    <div className="discover-hero-fade" />
    <div className="discover-hero-content">
      <div className="discover-hero-text">
        <div className="discover-hero-title-row">
          {repo.avatar_url && (
            <img className="discover-hero-avatar-img" src={repo.avatar_url} alt={repo.owner} />
          )}
          <div className="discover-hero-title">{repo.name}</div>
        </div>
        {desc && <div className="discover-hero-desc">{desc}</div>}
        {(repo.language || typeConfig) && (
          <div className="discover-hero-badges">
            {typeConfig && (
              <div className="discover-hero-pill" style={{ '--pill-accent': typeConfig.accentColor } as React.CSSProperties}>
                {typeConfig.icon && (
                  <span className="discover-hero-pill-icon">
                    <typeConfig.icon size={12} fill="currentColor" />
                  </span>
                )}
                {typeConfig.label}
              </div>
            )}
            {repo.language && (
              <div className="discover-hero-pill" style={{ '--pill-accent': langColor } as React.CSSProperties}>
                <span className="discover-hero-pill-icon">
                  <LanguageIcon lang={repo.language} size={14} boxed />
                </span>
                {repo.language}
              </div>
            )}
          </div>
        )}
        {repo.owner && (
          <div className="discover-hero-owner-row">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="discover-hero-owner-icon">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
            <span className="discover-hero-owner">{repo.owner}</span>
          </div>
        )}
      </div>
    </div>
  </div>
)
```

(The `.discover-hero-content` no longer has a second child — the right column is gone.)

- [ ] **Step 4: Edit `src/components/DiscoverHero.css`**

Remove the old `.discover-hero-icon-badge*` rules (lines 127–174 of the current file — the entire badges section starting from `.discover-hero-badges` through `:hover .discover-hero-icon-badge-text`). Replace with:

```css
.discover-hero-badges {
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: center;
  margin: 6px 0 10px;
  flex-wrap: wrap;
}

.discover-hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 6px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  background: color-mix(in srgb, var(--pill-accent) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--pill-accent) 55%, transparent);
  width: fit-content;
  --pill-accent: rgba(255, 255, 255, 0.4);
}

.discover-hero-pill-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

Also update `.discover-hero-content` so it no longer expects a second child:

```css
.discover-hero-content {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 0 20px 22px 16px;
  display: flex;
  align-items: flex-end;
}
```

(Removed: `justify-content: space-between` and `gap: 16px` — they were sized for the two-column layout.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/DiscoverHero.test.tsx`
Expected: PASS — all tests including the two new ones

- [ ] **Step 6: Commit**

```bash
git add src/components/DiscoverHero.tsx src/components/DiscoverHero.css src/components/DiscoverHero.test.tsx
git commit -m "feat(discover-hero): badges move inline between desc and owner"
```

---

## Task 7: Rewrite DiscoverTopNav as Netflix pill bar

**Files:**
- Modify: `src/components/DiscoverTopNav.tsx`
- Modify: `src/components/DiscoverTopNav.css`
- Modify: `src/components/DiscoverTopNav.test.tsx`

> **Note on existing tests:** `DiscoverTopNav.test.tsx` already references stale Home/Browse/Blocks/Filters buttons that don't exist in the current component. Rewrite it from scratch for the new contract.

- [ ] **Step 1: Replace `DiscoverTopNav.test.tsx`**

Replace the entire file with:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DiscoverTopNav from './DiscoverTopNav'

const baseProps = {
  selectedSubtypes: [],
  onSelectedSubtypesChange: vi.fn(),
  filters: {},
  selectedLanguages: [],
  activeVerification: new Set<'verified' | 'likely'>(),
  onFilterChange: vi.fn(),
  onSelectedLanguagesChange: vi.fn(),
  onVerificationToggle: vi.fn(),
  activePanel: null as 'buckets' | 'filters' | 'advanced' | null,
  onActivePanelChange: vi.fn(),
  viewMode: 'home' as const,
  onViewModeChange: vi.fn(),
  query: '',
  onQueryChange: vi.fn(),
  onSearch: vi.fn(),
}

describe('DiscoverTopNav', () => {
  it('renders search icon and three tab buttons by default', () => {
    render(<DiscoverTopNav {...baseProps} />)
    expect(screen.getByRole('button', { name: /search/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^recommended$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^agents$/i })).toBeTruthy()
  })

  it('marks the active tab with the active class', () => {
    render(<DiscoverTopNav {...baseProps} viewMode="recommended" />)
    expect(screen.getByRole('button', { name: /^recommended$/i })).toHaveClass('dtn-tab-active')
  })

  it('calls onViewModeChange when a tab is clicked', () => {
    const onViewModeChange = vi.fn()
    render(<DiscoverTopNav {...baseProps} onViewModeChange={onViewModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /^agents$/i }))
    expect(onViewModeChange).toHaveBeenCalledWith('agents')
  })

  it('replaces tabs with a search input when the search icon is clicked', () => {
    render(<DiscoverTopNav {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(screen.getByPlaceholderText(/search repos/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^home$/i })).toBeNull()
  })

  it('collapses back to tabs when Escape is pressed in the input', () => {
    render(<DiscoverTopNav {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    const input = screen.getByPlaceholderText(/search repos/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/search repos/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^home$/i })).toBeTruthy()
  })

  it('does NOT render a GitSuite brand or a Filter button', () => {
    render(<DiscoverTopNav {...baseProps} />)
    expect(document.querySelector('.dtn-brand')).toBeNull()
    expect(document.querySelector('.dtn-search-filter-btn')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/DiscoverTopNav.test.tsx`
Expected: FAIL — current component still has brand + filter button, and the search icon isn't a separate button.

- [ ] **Step 3: Rewrite `src/components/DiscoverTopNav.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { DiscoverSidebarProps } from './DiscoverSidebar'
import type { ViewModeKey } from '../lib/discoverQueries'
import './DiscoverTopNav.css'

type TopNavTab = 'home' | 'recommended' | 'agents'
const TABS: { key: TopNavTab; label: string }[] = [
  { key: 'home',        label: 'Home' },
  { key: 'recommended', label: 'Recommended' },
  { key: 'agents',      label: 'Agents' },
]

export interface DiscoverTopNavProps extends DiscoverSidebarProps {
  viewMode: ViewModeKey
  onViewModeChange: (key: ViewModeKey) => void
  compact?: boolean
}

export default function DiscoverTopNav({
  viewMode, onViewModeChange,
  query = '', onQueryChange, onSearch, inputRef,
  compact = false,
}: DiscoverTopNavProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const localInputRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localInputRef

  // Auto-focus the input when search expands
  useEffect(() => {
    if (searchOpen) ref.current?.focus()
  }, [searchOpen, ref])

  const closeSearch = () => {
    setSearchOpen(false)
    onQueryChange?.('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') closeSearch()
    if (e.key === 'Enter') onSearch?.()
  }

  // Map viewMode to tab key. 'all' is the legacy "Most Popular" sentinel that
  // we no longer surface as a tab; it falls back to 'home' here.
  const activeTab: TopNavTab =
      viewMode === 'recommended' ? 'recommended'
    : viewMode === 'agents'      ? 'agents'
    : 'home'

  return (
    <div className={`discover-top-nav${compact ? ' discover-top-nav--compact' : ''}`}>
      <div className="dtn-pill-bar">
        {!searchOpen && (
          <button
            type="button"
            className="dtn-search-icon-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            title="Search"
          >
            <Search size={16} />
          </button>
        )}
        {!searchOpen ? (
          TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`dtn-tab${activeTab === t.key ? ' dtn-tab-active' : ''}`}
              onClick={() => onViewModeChange(t.key as ViewModeKey)}
            >
              {t.label}
            </button>
          ))
        ) : (
          <div className="dtn-search-expanded">
            <Search size={14} className="dtn-search-expanded-icon" aria-hidden="true" />
            <input
              ref={ref}
              className="dtn-search-input"
              placeholder="Search repos…"
              value={query}
              onChange={e => onQueryChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="dtn-search-close-btn"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `src/components/DiscoverTopNav.css`**

Replace the entire file with:

```css
/* ── Wrapper ─────────────────────────────────────────────────── */
.discover-top-nav {
  position: fixed;
  top: 210px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  -webkit-app-region: drag;
  transition: top 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.discover-top-nav--compact {
  top: 4px;
}

/* ── Pill bar ────────────────────────────────────────────────── */
.dtn-pill-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.05) inset;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  -webkit-app-region: no-drag;
  transition: padding 0.2s ease;
}

.discover-top-nav--compact .dtn-pill-bar {
  padding: 4px 8px;
}

/* ── Search icon (leading) ───────────────────────────────────── */
.dtn-search-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  flex-shrink: 0;
}

.dtn-search-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--t1);
}

/* ── Tabs ────────────────────────────────────────────────────── */
.dtn-tab {
  padding: 7px 16px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.dtn-tab:hover {
  color: var(--t1);
  background: rgba(255, 255, 255, 0.05);
}

.dtn-tab-active {
  background: rgba(0, 0, 0, 0.7);
  color: var(--t1);
}

.dtn-tab-active:hover {
  background: rgba(0, 0, 0, 0.85);
}

.discover-top-nav--compact .dtn-tab {
  padding: 5px 12px;
  font-size: 13px;
}

/* ── Expanded search ─────────────────────────────────────────── */
.dtn-search-expanded {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 600px;
  padding: 4px 4px 4px 10px;
}

.discover-top-nav--compact .dtn-search-expanded {
  width: 400px;
}

.dtn-search-expanded-icon {
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

.dtn-search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--t1);
  caret-color: var(--t1);
}

.dtn-search-input::placeholder { color: rgba(255, 255, 255, 0.35); }

.dtn-search-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  flex-shrink: 0;
}

.dtn-search-close-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--t1);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/DiscoverTopNav.test.tsx`
Expected: PASS — 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/DiscoverTopNav.tsx src/components/DiscoverTopNav.css src/components/DiscoverTopNav.test.tsx
git commit -m "feat(discover): pill-bar nav with Home/Recommended/Agents tabs"
```

---

## Task 8: Wire Discover.tsx, ViewModeKey, and DiscoverGrid

**Goal:** Update the orchestrator (`Discover.tsx`) to consume the new components; widen `ViewModeKey` to `'home' | 'recommended' | 'agents'`; teach `DiscoverGrid` to render `AgentCard` on the Agents tab.

**Files:**
- Modify: `src/lib/discoverQueries.ts`
- Modify: `src/components/DiscoverGrid.tsx`
- Modify: `src/views/Discover.tsx`

- [ ] **Step 1: Widen `ViewModeKey`**

In `src/lib/discoverQueries.ts`, replace the `VIEW_MODES` array and `ViewModeKey` type at the top of the file with:

```typescript
export const VIEW_MODES = [
  { key: 'home',        label: 'Home',        accent: '#60a5fa' },
  { key: 'recommended', label: 'Recommended', accent: '#8b5cf6' },
  { key: 'agents',      label: 'Agents',      accent: '#f59e0b' },
] as const

export type ViewModeKey = (typeof VIEW_MODES)[number]['key']
```

Then update `buildViewModeQuery`'s switch:

```typescript
  switch (viewMode) {
    case 'recommended':
      return '' // handled by separate IPC handler
    case 'agents':
      return '' // agents come from window.api.agents.getAll(), not GitHub search
    case 'home':
      return langFilter
        ? `stars:>0 ${langFilter}`
        : 'stars:>100'
  }
```

`getViewModeSort` is fine as-is — it doesn't depend on the dropped key.

- [ ] **Step 2: Add Agents branch to `DiscoverGrid.tsx`**

Open `src/components/DiscoverGrid.tsx`. After the existing imports, add:

```typescript
import AgentCard from './AgentCard'
import type { AgentRow } from '../types/agent'
```

Add an `agents?: AgentRow[]` prop to `DiscoverGridProps`:

```typescript
export interface DiscoverGridProps {
  // … existing fields …
  agents?: AgentRow[]
}
```

In the component body, before the existing grid render (Grid mode), insert a branch:

```tsx
// Agents grid
if (viewMode === 'agents' && agents) {
  if (agents.length === 0) {
    return (
      <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
        No agents yet — create one from the Library.
      </div>
    )
  }
  return (
    <>
      <div
        ref={gridRef}
        className="discover-grid"
        data-cols={effectiveCols}
        style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
      >
        {agents.map((a, i) => (
          <ViewportWindow key={a.id} placeholderHeight={230}>
            <AgentCard agent={a} focused={i === focusIndex} />
          </ViewportWindow>
        ))}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </>
  )
}
```

Place this branch above the existing repo-grid return so agents short-circuit before falling through.

- [ ] **Step 3: Wire the new components in `Discover.tsx`**

The changes inside `Discover.tsx` are substantial; perform them in this order:

1. **Imports.** At the top of the file, add:

```typescript
import FilterChipRow from '../components/FilterChipRow'
import { rankAgents } from '../lib/agentRanking'
import type { AgentRow } from '../types/agent'
import DiscoverRowRepoCard from '../components/DiscoverRowRepoCard'
import DiscoverRowAgentCard from '../components/DiscoverRowAgentCard'
```

Remove the import of `GridHeader` (it is no longer used here).

2. **Snapshot normalisation.** Find the `viewMode` derivation block (search the file for `const viewMode: ViewModeKey = (() => {`) and update it to map dropped legacy values to `'home'`:

```typescript
  const viewMode: ViewModeKey = (() => {
    const v = searchParams.get('view')
    if (v === 'recommended') return 'recommended'
    if (v === 'agents')      return 'agents'
    return 'home'
  })()
```

3. **Add Agents state.** Below the existing repo states (`repos`, `rowRepos`, `recentlyVisited`), add:

```typescript
  const [rankedAgents, setRankedAgents] = useState<AgentRow[]>([])
  useEffect(() => {
    window.api.agents.getAll()
      .then(({ agents }) => setRankedAgents(rankAgents(agents)))
      .catch(() => setRankedAgents([]))
  }, [])
```

4. **Replace `loadTrending` view-mode checks.** The current `loadTrending` checks `viewMode === 'last-visited'`. Replace that branch with:

```typescript
      if (viewMode === 'agents') {
        // Agents are sourced via window.api.agents.getAll(); the agents state
        // is hydrated separately so no GitHub fetch is needed here.
        data = []
        setHasMore(false)
      } else if (viewMode === 'recommended' && selectedSubtypes.length === 0) {
        // … (existing recommended branch unchanged)
```

Also remove the entire `if (viewMode === 'last-visited') { … }` branch — search for `if (viewMode === 'last-visited')` to find it. After Step 2's snapshot normalisation, that view mode is unreachable.

5. **Drop the Last Visited row from Home.** Remove the JSX block that renders `<DiscoverRow title="Last Visited" .../>` (search for `title="Last Visited"`) and the associated `recentlyVisited` / `recentlyVisitedIndex` state declarations + the `useEffect` that calls `window.api.engagement.getRecentlyVisited(16)`. Confirm zero remaining matches with grep before continuing.

6. **Replace the two existing rows with the new `DiscoverRow` API.** The two existing `<DiscoverRow>` calls (one for Recommended, one for Last Visited before its removal) use the old `repos` + auto-renders. Update the surviving Recommended row + add an Agents row + add a Most Popular row, all using the generic API:

Locate the JSX block that renders DiscoverHero + DiscoverRow on Home — search for `<DiscoverHero repo={rowRepos[heroIndex]`. Replace the entire `viewMode === 'all' && ...` rendering block (we're renaming the gate to `viewMode === 'home' && ...`) with:

```tsx
{viewMode === 'home' && !topicMode && selectedSubtypes.length === 0 && !inSearchResults && (
  <>
    {rowRepos.length > 0
      ? <DiscoverHero repo={rowRepos[heroIndex] ?? null} onNavigate={navigateToRepo} />
      : <div className="discover-hero discover-hero--skeleton" />}

    {rowRepos.length > 0 && (
      <DiscoverRow
        title="Recommended for You"
        items={rowRepos}
        activeIndex={heroIndex}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onMore={() => setViewMode('recommended')}
        onPause={setHeroPaused}
        onAdvance={(delta) => {
          const visible = Math.min(effectiveCols, rowRepos.length)
          const max = Math.max(0, rowRepos.length - visible)
          setHeroIndex(i => Math.max(0, Math.min(max, i + delta)))
        }}
      />
    )}

    {rankedAgents.length > 0 && (
      <DiscoverRow
        title="Agents"
        items={rankedAgents}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={a => a.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowAgentCard
            agent={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
          />
        )}
        onMore={() => setViewMode('agents')}
        onAdvance={() => {/* horizontal scrolling on a static list not yet wired */}}
      />
    )}

    {repos.length > 0 && (
      <DiscoverRow
        title="Most Popular"
        items={repos.slice(0, 30)}
        activeIndex={0}
        columns={effectiveCols}
        getItemKey={r => r.id}
        renderCard={({ item, posIndex, columns, visible }) => (
          <DiscoverRowRepoCard
            repo={item}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={navigateToRepo}
            onLanguageClick={handleLanguageClick}
          />
        )}
        onAdvance={() => {/* horizontal scrolling on the popular slice */}}
      />
    )}
  </>
)}
```

7. **Replace `GridHeader` with `FilterChipRow`.** Find the `<GridHeader …/>` usage (search for `<GridHeader`) and replace it + the immediately-following `relatedTags` row JSX block with:

```tsx
{viewMode !== 'home' && (
  <FilterChipRow
    selectedLanguages={selectedLanguages}
    selectedSubtypes={selectedSubtypes}
    activeTags={activeTags}
    filters={appliedFilters}
    activeVerification={activeVerification}
    onRemoveLanguage={(lang) => setSelectedLanguages(prev => prev.filter(l => l !== lang))}
    onRemoveSubtype={(id) => setSelectedSubtypes(prev => prev.filter(s => s !== id))}
    onRemoveTag={(tag) => {
      const next = activeTags.filter(t => t !== tag)
      setActiveTags(next)
      if (next.length === 0) {
        setTopicMode(false)
        loadTrending(appliedFilters)
      } else {
        runTagSearch(next)
      }
    }}
    onClearAdvanced={(key) => setAppliedFilters(prev => ({ ...prev, [key]: undefined }))}
    onVerificationToggle={handleVerificationToggle}
    onSelectedLanguagesChange={setSelectedLanguages}
    onSelectedSubtypesChange={setSelectedSubtypes}
    onFilterChange={setAppliedFilters}
  />
)}
```

(Related-tags chips are deferred — they were a niche search feature that didn't survive the redesign. If you want to keep them, retain the existing `<div className="related-tags-row">…</div>` block above the chip row, gated on `viewMode !== 'home'`.)

8. **Pass agents to `DiscoverGrid`.** Update the `<DiscoverGrid … />` call:

```tsx
<DiscoverGrid
  loading={loading}
  loadingMore={loadingMore}
  error={error}
  visibleRepos={visibleRepos}
  agents={viewMode === 'agents' ? rankedAgents : undefined}
  discoverQuery={discoverQuery}
  layoutPrefs={effectiveLayoutPrefs}
  sentinelRef={sentinelRef}
  gridRef={gridRef}
  verification={verification}
  onNavigate={navigateToRepo}
  onTagClick={addTag}
  onOwnerClick={openProfile}
  focusIndex={kbFocusIndex}
  viewMode={viewMode}
  onStar={handleStar}
  onLanguageClick={handleLanguageClick}
  onSubtypeClick={handleSelectSubtype}
  anchorsByRepoId={anchorsByRepoId}
/>
```

9. **Update `DiscoverTopNav` invocation.** Find the existing `<DiscoverTopNav … />` call and update its props to use the new contract:

```tsx
<DiscoverTopNav
  selectedSubtypes={selectedSubtypes}
  onSelectedSubtypesChange={setSelectedSubtypes}
  filters={appliedFilters}
  selectedLanguages={selectedLanguages}
  activeVerification={activeVerification}
  onFilterChange={handleFilterChange}
  onSelectedLanguagesChange={setSelectedLanguages}
  onVerificationToggle={handleVerificationToggle}
  activePanel={activePanel}
  onActivePanelChange={setActivePanel}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
  query={discoverQuery}
  onQueryChange={(q) => { setDiscoverQuery(q); setContextQuery(q) }}
  onSearch={handleSearch}
  inputRef={topNavInputRef}
  compact={navCompact || viewMode !== 'home' || topicMode || selectedSubtypes.length > 0 || inSearchResults}
/>
```

(`layoutPrefs` and `onLayoutChange` are no longer needed in the top nav since the view tab is gone — but keep them on the `DiscoverSidebarProps` interface for `FilterOverlay` to ignore. The `View` panel from the old top nav is sunset.)

10. **Drop `GridHeader` import** if it's only used here (it lives in `src/components/GridHeader.tsx`). If grep shows it's used elsewhere, keep the file.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — including the new components' tests. Any failing tests under `src/views/Discover*.test.*` may need targeted updates to match the new view-mode strings; fix any references to `'all'` → `'home'` and remove assertions about Last Visited.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discoverQueries.ts src/components/DiscoverGrid.tsx src/views/Discover.tsx
git commit -m "feat(discover): wire pill-bar nav, chip row, Agents view"
```

---

## Task 9: Cleanup

**Goal:** Remove dead code after the rewrite settles.

**Files:**
- Modify: `src/components/DiscoverHero.css` (if any pre-redesign rules remain unused)
- Modify: `src/components/GridHeader.tsx` (delete if no longer imported anywhere)
- Modify: `src/views/Discover.tsx` (drop unused state)

- [ ] **Step 1: Search for orphaned `GridHeader` imports**

Run: `grep -rn "GridHeader" src/` (use the Grep tool).
Expected: Only `src/components/GridHeader.tsx` itself and possibly its test. If nothing else references it, delete the component.

- [ ] **Step 2: Remove unused state from `Discover.tsx`**

Delete the following declarations and their associated `useState` / `useEffect`:
- `recentlyVisited`, `setRecentlyVisited`, `recentlyVisitedIndex`, `setRecentlyVisitedIndex` (all references)
- The effect that calls `window.api.engagement.getRecentlyVisited`
- Any `Last Visited` text strings in the snapshot logic

Search: `grep -n "recentlyVisited\|last-visited" src/views/Discover.tsx`. Confirm zero matches after editing.

- [ ] **Step 3: Verify `DiscoverHero.css` has no orphaned classes**

Open `src/components/DiscoverHero.css` and confirm:
- `.discover-hero-icon-badge`, `.discover-hero-icon-badge-icon`, `.discover-hero-icon-badge-text` rules are removed (replaced by `.discover-hero-pill` in Task 6)
- `.discover-hero-badges`'s old right-column rules are replaced by the inline `flex-direction: row; margin: 6px 0 10px;` block

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS — entire suite green.

- [ ] **Step 5: Manual verification**

Per `feedback_no_visual_testing.md`: you do not need to launch the dev server. The user verifies UI changes themselves. Confirm via `git status` that only the planned files changed.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(discover): remove Last Visited + GridHeader leftovers"
```

---

## Open questions deferred to execution

- **DiscoverRow horizontal scrolling on static lists (Agents, Most Popular).** The carousel currently wraps at `length`; with no `onMore` advance handler the Most Popular and Agents rows are visually static beyond the first page. If horizontal scrolling matters, implement `onAdvance` index management in `Discover.tsx` mirroring `heroIndex` — small per-row index states.
- **Layout dropdown (grid/list/columns/density)** is currently hosted inside `DiscoverTopNav`'s old filter panel. Post-redesign there is no host. Either re-introduce a small layout button somewhere (likely on the chip row, far right) or sunset list mode on Discover. Address during execution.
- **Search history popover (`DiscoverSuggestions`)** anchoring — it currently anchors to the input via `getBoundingClientRect`. The new search input is inside the pill bar; verify the anchor still positions correctly in both expanded states and adjust if not.
