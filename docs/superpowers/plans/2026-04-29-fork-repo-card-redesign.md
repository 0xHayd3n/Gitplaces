# ForkMiniCard → ForkRepoCard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact `ForkMiniCard` inside `ForkEventCard` with a new `ForkRepoCard` that matches the Discover grid `RepoCard` visually — dither header, avatar + name + language badge title row, description, creator row, stats footer.

**Architecture:** New `ForkRepoCard` component (own `.tsx` + `.css`) slots in where `ForkMiniCard` was. `useForkData` gains one derived field (`avatarUrl`). `ForkEventCard` swaps the arrow from a plain character to a circle badge and removes all mini-card markup.

**Tech Stack:** React 18, TypeScript, CSS modules (plain CSS files), Vitest + React Testing Library, DitherBackground canvas component, LanguageIcon component.

**Spec:** `docs/superpowers/specs/2026-04-29-fork-repo-card-redesign-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/useForkData.ts` | Modify | Add `avatarUrl` to `ForkRepoData`; derive in `rowToForkData` |
| `src/components/ForkRepoCard.tsx` | Create | Card component + skeleton |
| `src/components/ForkRepoCard.css` | Create | All card styles (dither wrapper, info panel, skeleton shimmer classes) |
| `src/components/ForkRepoCard.test.tsx` | Create | Unit tests for `ForkRepoCard` |
| `src/components/ForkEventCard.tsx` | Modify | Swap `ForkMiniCard` → `ForkRepoCard`; circle arrow; avatarUrl fallback |
| `src/components/ForkEventCard.css` | Modify | Remove mini-card rules; add circle arrow; retain `@keyframes fork-shimmer` |
| `src/components/ForkEventCard.test.tsx` | Modify | Update selectors and expectations to match new component |

---

## Task 1: Extend `useForkData` with `avatarUrl`

**Files:**
- Modify: `src/hooks/useForkData.ts`

- [ ] **Step 1: Update `ForkRepoData` interface and `rowToForkData`**

  In `src/hooks/useForkData.ts`, add `avatarUrl: string` to the interface and derive it in `rowToForkData`:

  ```ts
  export interface ForkRepoData {
    owner: string
    name: string
    description: string | null
    language: string | null
    stars: number | null
    forks: number | null
    avatarUrl: string          // https://github.com/${owner}.png?size=40
  }

  function rowToForkData(row: RepoRow): ForkRepoData {
    return {
      owner: row.owner,
      name: row.name,
      description: row.description,
      language: row.language,
      stars: row.stars,
      forks: row.forks,
      avatarUrl: `https://github.com/${row.owner}.png?size=40`,
    }
  }
  ```

- [ ] **Step 2: Run existing tests to confirm no breakage**

  ```bash
  npx vitest run src/components/ForkEventCard.test.tsx
  ```

  Expected: all 7 tests pass (the mock in that file will need updating in Task 4, but it currently overrides the return value completely, so no breakage yet).

- [ ] **Step 3: Commit**

  ```bash
  git add src/hooks/useForkData.ts
  git commit -m "feat(feed): add avatarUrl to ForkRepoData"
  ```

---

## Task 2: Create `ForkRepoCard.css`

**Files:**
- Create: `src/components/ForkRepoCard.css`

- [ ] **Step 1: Write the CSS file**

  Create `src/components/ForkRepoCard.css`:

  ```css
  /* Card shell */
  .fork-repo-card {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    border: 1px solid #30363d;
    background: #0d1117;
    overflow: hidden;
    text-decoration: none;
    transition: border-color 0.15s;
  }

  .fork-repo-card:hover {
    border-color: #58a6ff;
  }

  .fork-repo-card--fork {
    border-color: #1f6feb;
  }

  .fork-repo-card--fork:hover {
    border-color: #58a6ff;
  }

  /* Dither header zone */
  .fork-repo-card__dither {
    position: relative;
    height: 65px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .fork-repo-card__dither--loading {
    background: #161b22;
  }

  /* FORK pill badge — rendered inside the dither zone, top-right */
  .fork-repo-card__fork-badge {
    position: absolute;
    top: 8px;
    right: 10px;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #0d2044;
    border: 1px solid #1f6feb;
    color: #58a6ff;
    padding: 2px 6px;
    border-radius: 3px;
    z-index: 1;
  }

  /* Info panel */
  .fork-repo-card__info {
    padding: 10px 11px 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  /* Title row: avatar + name + language badge */
  .fork-repo-card__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fork-repo-card__avatar {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex-shrink: 0;
    object-fit: cover;
  }

  .fork-repo-card__name {
    font-size: 13px;
    font-weight: 700;
    color: #c9d1d9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  /* Description */
  .fork-repo-card__desc {
    font-size: 10.5px;
    color: #8b949e;
    line-height: 1.45;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Creator row */
  .fork-repo-card__creator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #8b949e;
  }

  .fork-repo-card__creator-avatar {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
  }

  .fork-repo-card__creator-name {
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Stats footer */
  .fork-repo-card__stats {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9.5px;
    color: #8b949e;
  }

  /* ── Skeleton ──────────────────────────────────── */
  .fork-repo-card--skeleton {
    pointer-events: none;
  }

  /* Shimmer bars — reuse fork-shimmer keyframe from ForkEventCard.css */
  .frcs {
    background: linear-gradient(90deg, #21262d 25%, #2d333b 50%, #21262d 75%);
    background-size: 400% 100%;
    border-radius: 4px;
    animation: fork-shimmer 1.5s infinite;
  }

  .frcs--avatar      { width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; }
  .frcs--name        { height: 13px; flex: 1; max-width: 60%; }
  .frcs--badge       { width: 24px; height: 24px; border-radius: 4px; flex-shrink: 0; }
  .frcs--desc-full   { height: 10px; width: 100%; }
  .frcs--desc-short  { height: 10px; width: 65%; }
  .frcs--creator-avatar { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; }
  .frcs--creator-name   { height: 10px; width: 50px; }
  .frcs--stats          { height: 10px; width: 80px; }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/components/ForkRepoCard.css
  git commit -m "feat(feed): add ForkRepoCard styles"
  ```

---

## Task 3: Create `ForkRepoCard` component and tests

**Files:**
- Create: `src/components/ForkRepoCard.tsx`
- Create: `src/components/ForkRepoCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

  Create `src/components/ForkRepoCard.test.tsx`:

  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect } from 'vitest'
  import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'

  const baseProps = {
    owner: 'anthropics',
    name: 'Databuddy',
    avatarUrl: 'https://github.com/anthropics.png?size=40',
    description: 'Open-source analytics platform',
    language: 'TypeScript',
    stars: 4200,
    forks: 312,
    isFork: false,
  }

  describe('ForkRepoCard', () => {
    it('renders as a link to the correct GitHub URL', () => {
      render(<ForkRepoCard {...baseProps} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://github.com/anthropics/Databuddy')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('renders the repo name', () => {
      render(<ForkRepoCard {...baseProps} />)
      expect(screen.getByText('Databuddy')).toBeInTheDocument()
    })

    it('renders the dither zone', () => {
      const { container } = render(<ForkRepoCard {...baseProps} />)
      expect(container.querySelector('.fork-repo-card__dither')).toBeInTheDocument()
    })

    it('renders avatar with owner src in title row', () => {
      render(<ForkRepoCard {...baseProps} />)
      const imgs = screen.getAllByRole('img')
      expect(imgs.some(img => img.getAttribute('src') === baseProps.avatarUrl)).toBe(true)
    })

    it('renders description when provided', () => {
      render(<ForkRepoCard {...baseProps} />)
      expect(screen.getByText('Open-source analytics platform')).toBeInTheDocument()
    })

    it('omits description element when null', () => {
      render(<ForkRepoCard {...baseProps} description={null} />)
      expect(screen.queryByText('Open-source analytics platform')).toBeNull()
    })

    it('renders language badge when language provided', () => {
      const { container } = render(<ForkRepoCard {...baseProps} />)
      expect(container.querySelector('.repo-card-icon-badge')).toBeInTheDocument()
    })

    it('omits language badge when language is null', () => {
      const { container } = render(<ForkRepoCard {...baseProps} language={null} />)
      expect(container.querySelector('.repo-card-icon-badge')).toBeNull()
    })

    it('renders creator row with owner name', () => {
      render(<ForkRepoCard {...baseProps} />)
      expect(screen.getByText('anthropics')).toBeInTheDocument()
    })

    it('renders stats using formatCount format', () => {
      render(<ForkRepoCard {...baseProps} />)
      expect(screen.getByText(/4\.2k/)).toBeInTheDocument()
      expect(screen.getByText(/312/)).toBeInTheDocument()
    })

    it('source card: no FORK badge, forks stat visible', () => {
      render(<ForkRepoCard {...baseProps} isFork={false} />)
      expect(screen.queryByText('fork')).toBeNull()
      expect(screen.getByText(/312/)).toBeInTheDocument()
    })

    it('fork card: shows FORK badge, hides forks stat', () => {
      render(<ForkRepoCard {...baseProps} isFork={true} />)
      expect(screen.getByText('fork')).toBeInTheDocument()
      expect(screen.queryByText(/312/)).toBeNull()
    })

    it('fork card has blue border class', () => {
      const { container } = render(<ForkRepoCard {...baseProps} isFork={true} />)
      expect(container.firstChild).toHaveClass('fork-repo-card--fork')
    })
  })

  describe('ForkRepoCardSkeleton', () => {
    it('renders skeleton class', () => {
      const { container } = render(<ForkRepoCardSkeleton />)
      expect(container.querySelector('.fork-repo-card--skeleton')).toBeInTheDocument()
    })

    it('renders dither loading zone', () => {
      const { container } = render(<ForkRepoCardSkeleton />)
      expect(container.querySelector('.fork-repo-card__dither--loading')).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npx vitest run src/components/ForkRepoCard.test.tsx
  ```

  Expected: all tests FAIL with "Cannot find module './ForkRepoCard'".

- [ ] **Step 3: Implement `ForkRepoCard.tsx`**

  Create `src/components/ForkRepoCard.tsx`:

  ```tsx
  import DitherBackground from './DitherBackground'
  import LanguageIcon from './LanguageIcon'
  import { getLangColor } from '../lib/languages'
  import { formatCount } from './RepoCard'
  import './ForkRepoCard.css'

  interface ForkRepoCardProps {
    owner: string
    name: string
    avatarUrl: string
    description: string | null
    language: string | null
    stars: number | null
    forks: number | null
    isFork: boolean
  }

  export function ForkRepoCard({
    owner, name, avatarUrl, description, language, stars, forks, isFork,
  }: ForkRepoCardProps) {
    const fallbackGradient: [string, string] = language
      ? [getLangColor(language), '#0d1117']
      : ['#1a1f2e', '#0d1117']

    return (
      <a
        className={`fork-repo-card${isFork ? ' fork-repo-card--fork' : ''}`}
        href={`https://github.com/${owner}/${name}`}
        target="_blank"
        rel="noreferrer"
      >
        <div className="fork-repo-card__dither">
          <DitherBackground avatarUrl={avatarUrl} fallbackGradient={fallbackGradient} />
          {isFork && <span className="fork-repo-card__fork-badge">fork</span>}
        </div>
        <div className="fork-repo-card__info">
          <div className="fork-repo-card__title-row">
            <img
              className="fork-repo-card__avatar"
              src={avatarUrl}
              alt={owner}
              width={28}
              height={28}
            />
            <span className="fork-repo-card__name">{name}</span>
            {language && (
              <span
                className="repo-card-icon-badge"
                style={{ '--badge-color': getLangColor(language) } as React.CSSProperties}
              >
                <span className="repo-card-icon-badge-icon">
                  <LanguageIcon lang={language} size={18} boxed />
                </span>
                <span className="repo-card-icon-badge-text">{language}</span>
              </span>
            )}
          </div>
          {description && <p className="fork-repo-card__desc">{description}</p>}
          <div className="fork-repo-card__creator">
            <img
              className="fork-repo-card__creator-avatar"
              src={avatarUrl}
              alt={owner}
              width={16}
              height={16}
            />
            <span className="fork-repo-card__creator-name">{owner}</span>
          </div>
          <div className="fork-repo-card__stats">
            <span>★ {formatCount(stars)}</span>
            {!isFork && <span>⑂ {formatCount(forks)}</span>}
          </div>
        </div>
      </a>
    )
  }

  export function ForkRepoCardSkeleton() {
    return (
      <div className="fork-repo-card fork-repo-card--skeleton">
        <div className="fork-repo-card__dither fork-repo-card__dither--loading" />
        <div className="fork-repo-card__info">
          <div className="fork-repo-card__title-row">
            <div className="frcs frcs--avatar" />
            <div className="frcs frcs--name" />
            <div className="frcs frcs--badge" />
          </div>
          <div className="frcs frcs--desc-full" />
          <div className="frcs frcs--desc-short" />
          <div className="fork-repo-card__creator">
            <div className="frcs frcs--creator-avatar" />
            <div className="frcs frcs--creator-name" />
          </div>
          <div className="frcs frcs--stats" />
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npx vitest run src/components/ForkRepoCard.test.tsx
  ```

  Expected: all 15 tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/ForkRepoCard.tsx src/components/ForkRepoCard.test.tsx
  git commit -m "feat(feed): add ForkRepoCard component"
  ```

---

## Task 4: Update `ForkEventCard` — component, CSS, and tests

**Files:**
- Modify: `src/components/ForkEventCard.tsx`
- Modify: `src/components/ForkEventCard.css`
- Modify: `src/components/ForkEventCard.test.tsx`

- [ ] **Step 1: Update `ForkEventCard.test.tsx` (tests first — they will fail)**

  Replace the full contents of `src/components/ForkEventCard.test.tsx`:

  ```tsx
  import { render, screen } from '@testing-library/react'
  import { vi, describe, it, expect } from 'vitest'
  import { ForkEventCard } from './ForkEventCard'
  import type { GitHubFeedEvent } from '../hooks/useFeed'
  import type { ForkRepoData } from '../hooks/useForkData'

  vi.mock('../hooks/useForkData')

  const mockUseForkData = vi.mocked(
    (await import('../hooks/useForkData')).useForkData
  )

  const forkEvent: GitHubFeedEvent = {
    id: '1',
    type: 'ForkEvent',
    actor: { login: 'zzzzshawn', avatar_url: 'https://example.com/avatar.png' },
    repo: { full_name: 'anthropics/Databuddy' },
    payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
    created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  }

  const originalData: ForkRepoData = {
    owner: 'anthropics',
    name: 'Databuddy',
    description: 'Open-source analytics platform',
    language: 'TypeScript',
    stars: 4200,
    forks: 312,
    avatarUrl: 'https://github.com/anthropics.png?size=40',
  }

  const forkData: ForkRepoData = {
    owner: 'zzzzshawn',
    name: 'Databuddy',
    description: 'Open-source analytics platform',
    language: 'TypeScript',
    stars: 0,
    forks: 0,
    avatarUrl: 'https://github.com/zzzzshawn.png?size=40',
  }

  describe('ForkEventCard', () => {
    it('renders skeleton cards while loading', () => {
      mockUseForkData.mockReturnValue({ original: null, fork: null, loading: true })

      const { container } = render(<ForkEventCard event={forkEvent} />)

      expect(container.querySelector('.fork-repo-card--skeleton')).toBeInTheDocument()
      expect(screen.queryByText('Databuddy')).toBeNull()
    })

    it('renders actor header with login and timestamp', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      // actor in header + fork card creator row
      expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText(/forked a repository/)).toBeInTheDocument()
    })

    it('renders both repo names when loaded', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      expect(screen.getAllByText('Databuddy')).toHaveLength(2)
    })

    it('renders fork badge only on the fork card', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      expect(screen.getByText('fork')).toBeInTheDocument()
    })

    it('shows stars and forks on original card using formatCount', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      expect(screen.getByText(/4\.2k/)).toBeInTheDocument()
      expect(screen.getByText(/312/)).toBeInTheDocument()
    })

    it('links original and fork cards to correct GitHub URLs', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      const links = screen.getAllByRole('link')
      expect(links.some(l => l.getAttribute('href') === 'https://github.com/anthropics/Databuddy')).toBe(true)
      expect(links.some(l => l.getAttribute('href') === 'https://github.com/zzzzshawn/Databuddy')).toBe(true)
    })

    it('renders circle arrow between cards', () => {
      mockUseForkData.mockReturnValue({ original: originalData, fork: forkData, loading: false })

      const { container } = render(<ForkEventCard event={forkEvent} />)

      expect(container.querySelector('.fork-event__arrow-circle')).toBeInTheDocument()
    })

    it('falls back to repo name from event when API returns null', () => {
      mockUseForkData.mockReturnValue({ original: null, fork: null, loading: false })

      render(<ForkEventCard event={forkEvent} />)

      expect(screen.getAllByText('Databuddy')).toHaveLength(2)
      expect(screen.getByText('anthropics')).toBeInTheDocument()
      expect(screen.getAllByText('zzzzshawn').length).toBeGreaterThanOrEqual(1)
    })
  })
  ```

- [ ] **Step 2: Run updated tests to confirm they fail**

  ```bash
  npx vitest run src/components/ForkEventCard.test.tsx
  ```

  Expected: most tests FAIL — skeleton test looks for `.fork-repo-card--skeleton` which doesn't exist yet; arrow test fails; stats test expects `4.2k` but old code uses `toLocaleString`.

- [ ] **Step 3: Replace `ForkEventCard.css`**

  Full replacement of `src/components/ForkEventCard.css` — keep only event-shell rules and the shimmer keyframe:

  ```css
  .fork-event {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px 14px;
    border-bottom: 1px solid #21262d;
  }

  .fork-event__header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #8b949e;
  }

  .fork-event__avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .fork-event__time {
    margin-left: auto;
    font-size: 11px;
    color: #484f58;
  }

  .fork-event__body {
    display: flex;
    align-items: center;
  }

  .fork-event__arrow-col {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 44px;
    align-self: center;
  }

  .fork-event__arrow-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #161b22;
    border: 1px solid #30363d;
    color: #8b949e;
    font-size: 14px;
  }

  @keyframes fork-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  ```

- [ ] **Step 4: Replace `ForkEventCard.tsx`**

  Full replacement of `src/components/ForkEventCard.tsx` — remove `ForkMiniCard`, `ForkMiniCardSkeleton`; swap in `ForkRepoCard`; update arrow; add avatarUrl fallback:

  ```tsx
  import type { GitHubFeedEvent } from '../hooks/useFeed'
  import { useForkData } from '../hooks/useForkData'
  import { ForkRepoCard, ForkRepoCardSkeleton } from './ForkRepoCard'
  import './ForkEventCard.css'

  function relativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  interface Props {
    event: GitHubFeedEvent
  }

  export function ForkEventCard({ event }: Props) {
    const originalFullName = event.repo.full_name
    const forkFullName = (event.payload as { forkee: { full_name: string } }).forkee.full_name

    const { original, fork, loading } = useForkData(originalFullName, forkFullName)

    const [originalOwner, originalName] = originalFullName.split('/')
    const [forkOwner, forkName] = forkFullName.split('/')

    const arrow = (
      <div className="fork-event__arrow-col">
        <div className="fork-event__arrow-circle">→</div>
      </div>
    )

    return (
      <div className="fork-event">
        <div className="fork-event__header">
          <img
            className="fork-event__avatar"
            src={event.actor.avatar_url}
            alt={event.actor.login}
          />
          <span>
            <strong>{event.actor.login}</strong> forked a repository
          </span>
          <span className="fork-event__time">{relativeTime(event.created_at)}</span>
        </div>
        <div className="fork-event__body">
          {loading ? (
            <>
              <ForkRepoCardSkeleton />
              {arrow}
              <ForkRepoCardSkeleton />
            </>
          ) : (
            <>
              <ForkRepoCard
                owner={original?.owner ?? originalOwner}
                name={original?.name ?? originalName}
                avatarUrl={`https://github.com/${original?.owner ?? originalOwner}.png?size=40`}
                description={original?.description ?? null}
                language={original?.language ?? null}
                stars={original?.stars ?? null}
                forks={original?.forks ?? null}
                isFork={false}
              />
              {arrow}
              <ForkRepoCard
                owner={fork?.owner ?? forkOwner}
                name={fork?.name ?? forkName}
                avatarUrl={`https://github.com/${fork?.owner ?? forkOwner}.png?size=40`}
                description={fork?.description ?? null}
                language={fork?.language ?? null}
                stars={fork?.stars ?? null}
                forks={fork?.forks ?? null}
                isFork={true}
              />
            </>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 5: Run all affected tests**

  ```bash
  npx vitest run src/components/ForkEventCard.test.tsx src/components/ForkRepoCard.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

  ```bash
  npm test
  ```

  Expected: all tests PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/ForkEventCard.tsx src/components/ForkEventCard.css src/components/ForkEventCard.test.tsx
  git commit -m "feat(feed): replace ForkMiniCard with ForkRepoCard"
  ```
