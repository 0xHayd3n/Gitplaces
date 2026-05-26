# Grid Card Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the data-dense Discover card design with a Nexus-Mods-style layout (image-dominant, language overlay, title + author subtitle, fully-rounded type pill with bucket icon, 2-line description) across both `RepoCard` (grid) and `DiscoverRow` (carousel).

**Architecture:** New shared CSS classes (`.repo-card-image`, `.repo-card-pill`, `.repo-card-title-block`, etc.) added to `globals.css` alongside the existing `.repo-card-*` set. RepoCard and DiscoverRow JSX is rewritten to use only the new classes; star/learn/tags/anchor/verification UI is deleted from both. Old classes are preserved where `ForkRepoCard.tsx` and `RepoDetail.tsx` still depend on them; only classes exclusively used by RepoCard/DiscoverRow are deleted.

**Tech Stack:** React 18 + TypeScript + Vitest + @testing-library/react. Existing components: `DitherBackground`, `LanguageIcon`, `getSubTypeConfig`, `getBucketColor`/`getBucketGradient`.

**Reference spec:** [docs/superpowers/specs/2026-05-26-grid-card-overhaul-design.md](../specs/2026-05-26-grid-card-overhaul-design.md)

**Branch policy:** Work directly on `main` (no worktree). Commits go to main as each task lands.

---

## File map

| File | Action |
|---|---|
| `src/styles/globals.css` | Modify — add new `.repo-card-*` classes (Task 1), delete dead ones (Task 8) |
| `src/components/RepoCard.test.tsx` | **Create** — no existing test file |
| `src/components/RepoCard.tsx` | Modify — full rewrite of card markup, props, imports |
| `src/components/DiscoverGrid.tsx` | Modify — stop passing removed props to `RepoCard`, swap skeleton class |
| `src/components/DiscoverRow.test.tsx` | Modify — drop old assertions, add new ones |
| `src/components/DiscoverRow.tsx` | Modify — rewrite inner card markup to match RepoCard |
| `src/components/DiscoverRow.css` | Modify — delete now-dead inner-zone classes; keep carousel positioning |

---

## Task 1: Add new shared CSS classes to globals.css

**Files:**
- Modify: `src/styles/globals.css` (append a new block right after line 2306 — end of the existing `.repo-card *` rules)

The new classes coexist with the old ones. We do not delete anything in this task — that comes after the JSX migrates over (Task 8).

- [ ] **Step 1: Add new classes**

Open `src/styles/globals.css` and find the end of the existing `.repo-card` rules (after the `.repo-card .install-btn:hover` rule near line 2306). Insert a new block:

```css
/* ── New card design (Nexus-style) ─────────────────────────────── */
.repo-card-image {
  position: relative;
  height: 140px;
  overflow: hidden;
  flex-shrink: 0;
}

.repo-card-lang-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  z-index: 2;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.repo-card-lang-overlay:hover {
  background: rgba(0, 0, 0, 0.85);
  border-color: rgba(255, 255, 255, 0.25);
}

.repo-card-body {
  padding: 12px 14px 14px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  transition: background 0.2s;
}
.repo-card:hover .repo-card-body { background: rgba(0, 0, 0, 0.88); }

.repo-card-title-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.repo-card-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.25;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.repo-card-author {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  transition: color 0.15s;
}
.repo-card-author:hover { color: rgba(255, 255, 255, 0.85); }

.repo-card-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.9);
  background: color-mix(in srgb, var(--pill-accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--pill-accent) 30%, transparent);
  width: fit-content;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  font-family: inherit;
  --pill-accent: rgba(255, 255, 255, 0.4);
}
.repo-card-pill:hover {
  background: color-mix(in srgb, var(--pill-accent) 25%, transparent);
  border-color: color-mix(in srgb, var(--pill-accent) 50%, transparent);
}

.repo-card-pill-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--pill-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.repo-card-pill-icon svg { width: 10px; height: 10px; }

.repo-card-description {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: break-word;
  margin: 0;
}

/* Skeleton variant for the new image area (used by DiscoverGrid) */
.repo-card-skeleton-image { height: 140px; background: var(--bg3); }
```

- [ ] **Step 2: Verify CSS parses (no JSX consumer yet)**

Run: `npm test -- --run`
Expected: PASS — no test asserts against the new classes yet, so this should not break anything. If it fails, the failures should be unrelated to this change.

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "style(card): add Nexus-style class set alongside existing card classes"
```

---

## Task 2: Create RepoCard test file (TDD red)

**Files:**
- Create: `src/components/RepoCard.test.tsx`

There's no existing test for `RepoCard`. We write the failing tests first; the implementation in Task 3 makes them pass.

- [ ] **Step 1: Write the failing test file**

Create `src/components/RepoCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RepoCard from './RepoCard'
import type { RepoRow } from '../types/repo'

vi.mock('./DitherBackground', () => ({
  default: () => <div data-testid="dither-bg" />,
}))
vi.mock('./LanguageIcon', () => ({
  default: ({ lang }: { lang: string }) => <span data-testid="lang-icon">{lang}</span>,
}))

// Stub the window.api surface the new RepoCard touches in its translate effect.
// Merge into existing window.api (src/test/setup.ts already stubs tts).
beforeAll(() => {
  const w = globalThis as unknown as { window: { api: Record<string, unknown> } }
  w.window.api = {
    ...(w.window.api ?? {}),
    settings: { getPreferredLanguage: vi.fn().mockResolvedValue('en') },
    translate: {
      check:     vi.fn().mockResolvedValue(null),
      translate: vi.fn().mockResolvedValue(null),
    },
    db: { cacheTranslatedDescription: vi.fn().mockResolvedValue(undefined) },
  }
})

function makeRepo(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: 'kirillzyusko/react-native-keyboard-controller',
    owner: 'kirillzyusko',
    name: 'react-native-keyboard-controller',
    description: 'Keyboard manager which works in identical way on both iOS and Android.',
    language: 'TypeScript',
    stars: 1000, forks: 100,
    topics: '[]',
    avatar_url: null, starred_at: null, unstarred_at: null, pushed_at: null,
    license: null, homepage: null, updated_at: null, saved_at: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    watchers: null, size: null, open_issues: null, default_branch: null,
    og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null, verification_signals: null,
    verification_checked_at: null, type_bucket: null, type_sub: null,
    is_forked: null, update_available: null, update_checked_at: null,
    upstream_version: null, stored_version: null,
    ...overrides,
  }
}

function renderCard(props: Partial<React.ComponentProps<typeof RepoCard>> = {}) {
  return render(<RepoCard repo={makeRepo()} onNavigate={vi.fn()} {...props} />)
}

describe('RepoCard (Nexus-style)', () => {
  it('renders title, author subtitle, and description', () => {
    const { container } = renderCard()
    expect(container.querySelector('.repo-card-title')?.textContent).toBe('react-native-keyboard-controller')
    expect(container.querySelector('.repo-card-author')?.textContent).toBe('by kirillzyusko')
    expect(container.querySelector('.repo-card-description')?.textContent)
      .toBe('Keyboard manager which works in identical way on both iOS and Android.')
  })

  it('renders the language overlay with the language icon when language is set', () => {
    const { container } = renderCard()
    const overlay = container.querySelector('.repo-card-lang-overlay')
    expect(overlay).toBeTruthy()
    expect(overlay?.querySelector('[data-testid="lang-icon"]')?.textContent).toBe('TypeScript')
  })

  it('hides the language overlay when language is absent', () => {
    const { container } = renderCard({ repo: makeRepo({ language: null }) })
    expect(container.querySelector('.repo-card-lang-overlay')).toBeNull()
  })

  it('renders a type pill with subtype label when typeSub is provided', () => {
    const { container } = renderCard({ typeSub: 'mobile-library' })
    const pill = container.querySelector('.repo-card-pill')
    // The exact label depends on getSubTypeConfig; just assert pill is present
    // and that it contains the icon dot.
    expect(pill).toBeTruthy()
    expect(pill?.querySelector('.repo-card-pill-icon')).toBeTruthy()
  })

  it('hides the type pill when neither typeSub nor typeBucket is provided', () => {
    const { container } = renderCard()
    expect(container.querySelector('.repo-card-pill')).toBeNull()
  })

  it('does NOT render star button, learn button, tag chips, or anchor strip', () => {
    const { container } = renderCard({
      repo: makeRepo({ topics: '["mobile","keyboard","react-native"]', starred_at: '2026-01-01' }),
    })
    expect(container.querySelector('.repo-card-badge-br')).toBeNull()
    expect(container.querySelector('.repo-card-badge-learn')).toBeNull()
    expect(container.querySelector('.repo-card-tag')).toBeNull()
    expect(container.querySelector('.repo-card-anchors')).toBeNull()
  })

  it('clicking the card calls onNavigate with /repo/:owner/:name', async () => {
    const onNavigate = vi.fn()
    const { container } = renderCard({ onNavigate })
    await userEvent.click(container.querySelector('.repo-card')!)
    expect(onNavigate).toHaveBeenCalledWith('/repo/kirillzyusko/react-native-keyboard-controller')
  })

  it('clicking the author subtitle calls onOwnerClick (and not onNavigate)', async () => {
    const onOwnerClick = vi.fn()
    const onNavigate = vi.fn()
    const { container } = renderCard({ onOwnerClick, onNavigate })
    await userEvent.click(container.querySelector('.repo-card-author')!)
    expect(onOwnerClick).toHaveBeenCalledWith('kirillzyusko')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clicking the language overlay calls onLanguageClick (and not onNavigate)', async () => {
    const onLanguageClick = vi.fn()
    const onNavigate = vi.fn()
    const { container } = renderCard({ onLanguageClick, onNavigate })
    await userEvent.click(container.querySelector('.repo-card-lang-overlay')!)
    expect(onLanguageClick).toHaveBeenCalledWith('TypeScript')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('clicking the type pill calls onSubtypeClick (and not onNavigate)', async () => {
    const onSubtypeClick = vi.fn()
    const onNavigate = vi.fn()
    const { container } = renderCard({ typeSub: 'mobile-library', onSubtypeClick, onNavigate })
    await userEvent.click(container.querySelector('.repo-card-pill')!)
    expect(onSubtypeClick).toHaveBeenCalledWith('mobile-library')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('applies starred glow class when repo.starred_at is set', () => {
    const { container } = renderCard({ repo: makeRepo({ starred_at: '2026-01-01' }) })
    expect(container.querySelector('.repo-card')?.classList.contains('repo-card-starred')).toBe(true)
  })

  it('applies learned glow class when learnState is LEARNED', () => {
    const { container } = renderCard({ learnState: 'LEARNED' })
    expect(container.querySelector('.repo-card')?.classList.contains('repo-card-learned')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npm test -- --run src/components/RepoCard.test.tsx`
Expected: Tests fail — `RepoCard` does not yet render the new class names (`.repo-card-title`, `.repo-card-author`, `.repo-card-description`, `.repo-card-lang-overlay`, `.repo-card-pill`).

Do NOT commit yet — the failing tests live with the implementation in Task 3.

---

## Task 3: Rewrite RepoCard.tsx

**Files:**
- Modify: `src/components/RepoCard.tsx` (full rewrite — ~440 LOC → ~190 LOC)

- [ ] **Step 1: Replace the entire file**

Open `src/components/RepoCard.tsx` and replace its contents with:

```tsx
import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { type RepoRow } from '../types/repo'
import DitherBackground from './DitherBackground'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import LanguageIcon from './LanguageIcon'

// ── Module-level IPC cache for the user's preferred translation language ─
let _preferredLangPromise: Promise<string> | null = null
function getPreferredLang(): Promise<string> {
  if (!_preferredLangPromise) {
    _preferredLangPromise = window.api.settings.getPreferredLanguage().catch(() => 'en')
  }
  return _preferredLangPromise
}

// ── Format helpers (exported — DiscoverRow re-uses these) ──────────
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

export function formatRecency(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return 'just now'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}y`
}

// ── Emoji shortcode parser ─────────────────────────────────────────
const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦', electric_plug:'🔌',
  battery:'🔋', satellite:'🛰️', cloud:'☁️', floppy_disk:'💾', cd:'💿',
  snake:'🐍', crab:'🦀', whale:'🐳', elephant:'🐘', robot:'🤖', brain:'🧠',
  microscope:'🔬', telescope:'🔭', dna:'🧬', test_tube:'🧪', abacus:'🧮',
  chart_with_upwards_trend:'📈', bar_chart:'📊', chart:'📊',
  book:'📖', books:'📚', memo:'📝', pencil:'✏️', clipboard:'📋',
  scroll:'📜', card_index:'📇', file_folder:'📁', open_file_folder:'📂',
  star:'⭐', star2:'🌟', sparkles:'✨', tada:'🎉', trophy:'🏆', dart:'🎯',
  checkered_flag:'🏁', medal:'🏅', white_check_mark:'✅', x:'❌',
  warning:'⚠️', construction:'🚧', no_entry:'⛔', shield:'🛡️', lock:'🔒',
  key:'🔑', mag:'🔍', mag_right:'🔍', link:'🔗', globe:'🌐',
  information_source:'ℹ️', question:'❓', exclamation:'❗',
  speech_balloon:'💬', loudspeaker:'📢', bell:'🔔', mailbox:'📬',
  heart:'❤️', green_heart:'💚', blue_heart:'💙', purple_heart:'💜',
  art:'🎨', rainbow:'🌈', seedling:'🌱', herb:'🌿', coffee:'☕',
  wave:'👋', point_right:'👉', arrow_right:'➡️', new:'🆕',
  fast_forward:'⏩', hourglass:'⏳', stopwatch:'⏱️', calendar:'📅',
  desktop_computer:'🖥️', keyboard:'⌨️', mouse:'🖱️', printer:'🖨️',
  iphone:'📱', camera:'📷', video_camera:'📹', tv:'📺',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

// ── Repo Card ─────────────────────────────────────────────────────
interface RepoCardProps {
  repo: RepoRow
  onNavigate: (path: string) => void
  onOwnerClick?: (owner: string) => void
  onLanguageClick?: (lang: string) => void
  onSubtypeClick?: (subtypeId: string) => void
  typeSub?: string | null
  typeBucket?: string | null
  focused?: boolean
  learnState?: 'UNLEARNED' | 'LEARNING' | 'LEARNED'
}

const RepoCard = memo(function RepoCard({
  repo, onNavigate, onOwnerClick, onLanguageClick, onSubtypeClick,
  typeSub, typeBucket, focused, learnState,
}: RepoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const starred = !!repo.starred_at

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [focused])

  // Description translation
  const [displayDescription, setDisplayDescription] = useState(repo.description ?? '')
  useEffect(() => {
    async function checkAndTranslate() {
      if (!repo.description || repo.description.length < 6) return
      const preferredLang = await getPreferredLang()
      if (repo.translated_description && repo.translated_description_lang === preferredLang) {
        setDisplayDescription(repo.translated_description)
        return
      }
      const scriptLang = await window.api.translate.check(repo.description, preferredLang, 6).catch(() => null)
      if (!scriptLang) return
      const result = await window.api.translate.translate(repo.description, preferredLang).catch(() => null)
      if (!result) return
      setDisplayDescription(result.translatedText)
      if (repo.id) {
        window.api.db.cacheTranslatedDescription(
          repo.id, result.translatedText, preferredLang, scriptLang,
        ).catch(() => {})
      }
    }
    checkAndTranslate()
  }, [repo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(typeSub)
  const pillAccent = typeConfig?.accentColor ?? (typeBucket ? getBucketColor(typeBucket) : null)
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(typeBucket))
  const parsedDescription = useMemo(() => parseEmoji(displayDescription), [displayDescription])

  return (
    <div
      ref={cardRef}
      className={`repo-card${focused ? ' kb-focused' : ''}${starred ? ' repo-card-starred' : ''}${learnState === 'LEARNED' ? ' repo-card-learned' : ''}`}
      onClick={() => onNavigate(`/repo/${repo.owner}/${repo.name}`)}
    >
      <div className="repo-card-image">
        <DitherBackground avatarUrl={repo.avatar_url} fallbackGradient={gradient} />
        {repo.language && (
          <span
            className="repo-card-lang-overlay"
            onClick={e => { e.stopPropagation(); onLanguageClick?.(repo.language!) }}
            title={repo.language}
          >
            <LanguageIcon lang={repo.language} size={18} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{repo.name}</div>
          <button
            type="button"
            className="repo-card-author"
            onClick={e => { e.stopPropagation(); onOwnerClick?.(repo.owner) }}
          >
            by {repo.owner}
          </button>
        </div>
        {typeConfig && pillAccent && typeSub && (
          <button
            type="button"
            className="repo-card-pill"
            style={{ '--pill-accent': pillAccent } as React.CSSProperties}
            onClick={e => { e.stopPropagation(); onSubtypeClick?.(typeSub) }}
          >
            {typeConfig.icon && (
              <span className="repo-card-pill-icon">
                <typeConfig.icon size={10} fill="currentColor" />
              </span>
            )}
            {typeConfig.label}
          </button>
        )}
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
      </div>
    </div>
  )
})

export default RepoCard
```

- [ ] **Step 2: Run RepoCard tests and confirm pass**

Run: `npm test -- --run src/components/RepoCard.test.tsx`
Expected: PASS — all 11 tests should now pass.

- [ ] **Step 3: Run the full test suite to catch upstream callers**

Run: `npm test -- --run`
Expected: Likely failures in `DiscoverGrid` callers (TypeScript will flag removed prop types). Note any failures — Task 4 fixes them. If only `DiscoverGrid`-related failures exist, proceed to Task 4. If unrelated tests fail, stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add src/components/RepoCard.tsx src/components/RepoCard.test.tsx
git commit -m "feat(card): rewrite RepoCard with Nexus-style layout"
```

---

## Task 4: Update DiscoverGrid caller

**Files:**
- Modify: `src/components/DiscoverGrid.tsx`

Remove props that no longer exist on `RepoCard` (`onTagClick`, `viewMode` passthrough, `verificationTier`, `verificationSignals`, `verificationResolving`, `onStar`, `anchors`). Swap the skeleton's image class to the new `.repo-card-skeleton-image`.

- [ ] **Step 1: Update the `<RepoCard>` call site**

Find the `<RepoCard ... />` JSX in `src/components/DiscoverGrid.tsx` (around line 176). Replace it with:

```tsx
<RepoCard
  repo={repo}
  onNavigate={onNavigate}
  onOwnerClick={onOwnerClick}
  typeSub={repo.type_sub}
  typeBucket={repo.type_bucket}
  focused={i === focusIndex}
  onLanguageClick={onLanguageClick}
  onSubtypeClick={onSubtypeClick}
/>
```

- [ ] **Step 2: Update the loadingMore skeleton block**

Find the `loadingMore` skeleton render in `DiscoverGrid.tsx` (around line 195). Replace `repo-card-skeleton-dither` with `repo-card-skeleton-image`:

```tsx
{loadingMore && Array.from({ length: effectiveCols }).map((_, i) => (
  <div key={`skel-${i}`} className="repo-card-skeleton">
    <div className="repo-card-skeleton-image shimmer" />
    <div className="repo-card-skeleton-info">
      <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 4 }} />
      <div className="shimmer" style={{ width: '80%', height: 8, borderRadius: 4, marginTop: 6 }} />
      <div className="shimmer" style={{ width: '40%', height: 8, borderRadius: 4, marginTop: 6 }} />
    </div>
  </div>
))}
```

Also update the initial `loading` skeleton render earlier in the file (around line 78) the same way:

```tsx
{Array.from({ length: effectiveCols * 3 }).map((_, i) => (
  <div key={i} className="repo-card-skeleton">
    <div className="repo-card-skeleton-image shimmer" />
    <div className="repo-card-skeleton-info">
      <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 4 }} />
      <div className="shimmer" style={{ width: '80%', height: 8, borderRadius: 4, marginTop: 6 }} />
      <div className="shimmer" style={{ width: '40%', height: 8, borderRadius: 4, marginTop: 6 }} />
    </div>
  </div>
))}
```

Leave the rest of the file alone — `DiscoverGridProps` keeps `onTagClick`, `viewMode`, `verification`, `onStar`, `anchorsByRepoId` because the **list mode** (`RepoListRow`) still consumes them. Don't touch the prop interface.

- [ ] **Step 3: Verify TypeScript + tests pass**

Run: `npm test -- --run`
Expected: PASS — DiscoverGrid → RepoCard handoff now matches the new prop interface. DiscoverRow tests still pass (it hasn't been touched yet — old code, old assertions).

- [ ] **Step 4: Commit**

```bash
git add src/components/DiscoverGrid.tsx
git commit -m "feat(card): wire DiscoverGrid to slim RepoCard props + new skeleton class"
```

---

## Task 5: Update DiscoverRow tests (TDD red for DiscoverRow)

**Files:**
- Modify: `src/components/DiscoverRow.test.tsx`

- [ ] **Step 1: Replace test assertions**

Replace the entire body of `src/components/DiscoverRow.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoverRow from './DiscoverRow'
import type { RepoRow } from '../types/repo'

vi.mock('./DitherBackground', () => ({
  default: () => <div data-testid="dither-bg" />,
}))
vi.mock('./LanguageIcon', () => ({
  default: ({ lang }: { lang: string }) => <span data-testid="lang-icon">{lang}</span>,
}))

vi.mock('../hooks/useBayerDither', () => ({ useBayerDither: vi.fn() }))

beforeAll(() => {
  // ResizeObserver is already stubbed in src/test/setup.ts, but the existing
  // test set it locally too — keep that for parity with prior behaviour.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const w = globalThis as unknown as { window: { api: Record<string, unknown> } }
  w.window.api = {
    ...(w.window.api ?? {}),
    settings: { getPreferredLanguage: vi.fn().mockResolvedValue('en') },
    translate: {
      check:     vi.fn().mockResolvedValue(null),
      translate: vi.fn().mockResolvedValue(null),
    },
    db: { cacheTranslatedDescription: vi.fn().mockResolvedValue(undefined) },
  }
})

function makeRepo(owner: string, name: string, overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: `${owner}/${name}`, owner, name,
    description: 'Sample description text.',
    language: 'TypeScript', stars: 1000, forks: 100,
    topics: '[]', avatar_url: null, starred_at: null, unstarred_at: null, pushed_at: null,
    license: null, homepage: null, updated_at: null, saved_at: null,
    type: null, banner_svg: null, discovered_at: null, discover_query: null,
    watchers: null, size: null, open_issues: null, default_branch: null,
    og_image_url: null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null, detected_language: null,
    verification_score: null, verification_tier: null, verification_signals: null,
    verification_checked_at: null, type_bucket: null, type_sub: null,
    is_forked: null, update_available: null, update_checked_at: null,
    upstream_version: null, stored_version: null,
    ...overrides,
  }
}

const repos = [
  makeRepo('facebook', 'react'),
  makeRepo('microsoft', 'vscode'),
  makeRepo('golang', 'go'),
]

describe('DiscoverRow', () => {
  it('renders null when repos is empty', () => {
    const { container } = render(
      <DiscoverRow repos={[]} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a card for each repo', () => {
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    expect(screen.getByRole('button', { name: 'facebook/react' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'microsoft/vscode' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'golang/go' })).toBeTruthy()
  })

  it('renders "Recommended for You" section heading', () => {
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    expect(screen.getByText('Recommended for You')).toBeTruthy()
  })

  it('calls onMore when More button is clicked', async () => {
    const onMore = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={onMore} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByRole('button', { name: /see all/i }))
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('calls onNavigate with correct path when a card is clicked', async () => {
    const onNavigate = vi.fn()
    render(<DiscoverRow repos={repos} activeIndex={0} onNavigate={onNavigate} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />)
    await userEvent.click(screen.getByRole('button', { name: 'facebook/react' }))
    expect(onNavigate).toHaveBeenCalledWith('/repo/facebook/react')
  })

  it('renders the new card structure (title, author, description, language overlay)', () => {
    const { container } = render(
      <DiscoverRow repos={repos} activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3} />,
    )
    // Pick the active card (first non-peek slot)
    expect(container.querySelector('.repo-card-title')).toBeTruthy()
    expect(container.querySelector('.repo-card-author')).toBeTruthy()
    expect(container.querySelector('.repo-card-description')).toBeTruthy()
    expect(container.querySelector('.repo-card-lang-overlay')).toBeTruthy()
  })

  it('does NOT render star button, license chip, recency stat, or tag chips', () => {
    const { container } = render(
      <DiscoverRow
        repos={[makeRepo('facebook', 'react', { topics: '["ui","library"]', license: 'MIT', pushed_at: new Date().toISOString() })]}
        activeIndex={0} onNavigate={vi.fn()} onMore={vi.fn()} onAdvance={vi.fn()} columns={3}
      />,
    )
    expect(container.querySelector('.repo-card-badge-br')).toBeNull()
    expect(container.querySelector('.discover-row-card-license')).toBeNull()
    expect(container.querySelector('.discover-row-card-stat')).toBeNull()
    expect(container.querySelector('.discover-row-card-tag')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test file to confirm new structure tests fail**

Run: `npm test -- --run src/components/DiscoverRow.test.tsx`
Expected: The two new tests ("renders the new card structure" and "does NOT render star button…") fail because DiscoverRow still has the old markup. Old tests still pass.

Do NOT commit yet — implementation follows in Task 6.

---

## Task 6: Rewrite DiscoverRow.tsx

**Files:**
- Modify: `src/components/DiscoverRow.tsx`

- [ ] **Step 1: Replace the file**

Open `src/components/DiscoverRow.tsx` and replace its contents with:

```tsx
import { useState, useEffect, useMemo } from 'react'
import './DiscoverRow.css'
import DitherBackground from './DitherBackground'
import LanguageIcon from './LanguageIcon'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import { type RepoRow } from '../types/repo'

interface DiscoverRowProps {
  repos: RepoRow[]
  activeIndex: number
  columns: number
  onNavigate: (path: string) => void
  onAdvance: (delta: number) => void
  title?: string
  onMore?: () => void
  onPause?: (paused: boolean) => void
}

// Emoji shortcode parser kept local — RepoCard exports a similar table but we
// avoid coupling so DiscoverRow stays portable if RepoCard's surface changes.
const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦',
  star:'⭐', sparkles:'✨', heart:'❤️', brain:'🧠', robot:'🤖',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

function DiscoverRowCardItem({
  repo, posIndex, columns, visible, onNavigate,
}: {
  repo: RepoRow
  posIndex: number
  columns: number
  visible: number
  onNavigate: (path: string) => void
}) {
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
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(repo.type))
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
          <span className="repo-card-lang-overlay" title={repo.language}>
            <LanguageIcon lang={repo.language} size={18} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{repo.name}</div>
          <span className="repo-card-author">by {repo.owner}</span>
        </div>
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
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
      </div>
    </button>
  )
}

export default function DiscoverRow({ repos, activeIndex, columns, onNavigate, onAdvance, title = 'Recommended for You', onMore, onPause }: DiscoverRowProps) {
  if (repos.length === 0) return null

  const visible = Math.min(columns, repos.length)
  const slots: { repo: RepoRow; posIndex: number }[] = Array.from({ length: visible }, (_, i) => ({
    repo: repos[(activeIndex + i) % repos.length],
    posIndex: i,
  }))

  if (repos.length > visible) {
    slots.unshift({
      repo: repos[(activeIndex - 1 + repos.length) % repos.length],
      posIndex: -1,
    })
  }
  if (repos.length >= visible + 2) {
    slots.push({
      repo: repos[(activeIndex + visible) % repos.length],
      posIndex: visible,
    })
  }

  const atStart = activeIndex === 0
  const atEnd = activeIndex >= Math.max(0, repos.length - visible)

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
        {slots.map(({ repo, posIndex }) => (
          <DiscoverRowCardItem
            key={repo.id}
            repo={repo}
            posIndex={posIndex}
            columns={columns}
            visible={visible}
            onNavigate={onNavigate}
          />
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

Note: `formatCount` and `formatRecency` are no longer imported here (no star count, no recency display). DiscoverRow stops importing from `./RepoCard`.

- [ ] **Step 2: Run DiscoverRow tests**

Run: `npm test -- --run src/components/DiscoverRow.test.tsx`
Expected: PASS — all 7 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `npm test -- --run`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiscoverRow.tsx src/components/DiscoverRow.test.tsx
git commit -m "feat(card): rewrite DiscoverRow carousel cards with Nexus-style layout"
```

---

## Task 7: Clean up DiscoverRow.css

**Files:**
- Modify: `src/components/DiscoverRow.css`

Drop classes that the new JSX no longer references. Keep all outer carousel structure (`.discover-row*`, nav zones, peek/p0, hover, starred outer border, skeleton classes).

- [ ] **Step 1: Remove dead classes**

In `src/components/DiscoverRow.css`, delete the following rules (the inner-card zones that the new markup no longer uses):

- `.discover-row-card-dither` (replaced by global `.repo-card-image`)
- `.discover-row-card-info` (replaced by global `.repo-card-body`)
- `.discover-row-card:hover .discover-row-card-info`
- `.discover-row-card-top`
- `.discover-row-card-avatar`
- `.discover-row-card-top-text`
- `.discover-row-card-name`
- `.discover-row-card-desc`
- `.discover-row-card-grow`
- `.discover-row-card-footer`
- `.discover-row-card-footer-left`
- `.discover-row-card-stats`
- `.discover-row-card-stat`
- `.discover-row-card-owner`
- `.discover-row-card-stats .discover-row-card-stat + .discover-row-card-stat::before`
- `.discover-row-card-tags`
- `.discover-row-card-tag`
- `.discover-row-card-footer-badges`

**Keep** (verbatim): `.discover-row`, `.discover-row-header`, `.discover-row-title-btn`, `.discover-row-title-btn:hover`, `.discover-row-title-chevron`, `.discover-row-title-btn:hover .discover-row-title-chevron`, `.discover-row-title-static`, `.discover-row-carousel`, `.discover-row-card`, `.discover-row-card--peek`, `.discover-row-card--p0`, `.discover-row-card:hover`, `.discover-row-card--starred`, `.discover-row-nav-zone*`, `.discover-row-skeleton-title`, `.discover-row-skeleton-carousel`.

- [ ] **Step 2: Run tests + check visually with `npm test` only (no dev server)**

Run: `npm test -- --run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/DiscoverRow.css
git commit -m "style(card): drop dead inner-zone classes from DiscoverRow.css"
```

---

## Task 8: Sweep dead `.repo-card-*` classes from globals.css

**Files:**
- Modify: `src/styles/globals.css`

Only delete classes that are exclusively used by the rewritten RepoCard/DiscoverRow. Classes used by `ForkRepoCard.tsx`, `RepoDetail.tsx`, or anywhere else stay.

- [ ] **Step 1: Delete classes that are now dead**

In `src/styles/globals.css`, remove these rule blocks (verified RepoCard/DiscoverRow only):

- `.repo-card-actions` (line ~2044)
- `.repo-card-badge-br` and `.repo-card-badge-br:hover` and `.repo-card-badge-br.starred` and `.repo-card-badge-br:disabled` (lines ~2045–2073)
- `.repo-card-badge-learn`, `.repo-card-badge-learn:hover`, `.repo-card-badge-learn.learned`, `.repo-card-badge-learn.learning`, `.repo-card-badge-learn.learning span:last-child`, `.repo-card-badge-learn:disabled` (lines ~2053–2072)
- `.repo-card-badge-tl` (line ~2075)
- `.repo-card-tag-text`, `.repo-card-tag:hover .repo-card-tag-text` (lines ~2208–2215)
- `.repo-card-tag-icon`, `.repo-card-tag:hover .repo-card-tag-icon` (lines ~2216–2230)
- `.repo-card-anchors`, `.repo-card-anchors-label`, `.repo-card-anchor-chips`, `.repo-card-anchor-chip`, `.repo-card-anchor-chip:hover`, `.repo-card-anchor-avatar`, `.repo-card-anchor-name` (lines ~10982–11040)
- Hover-state rules that target only deleted elements: `.repo-card:hover .repo-card-badge-br`, `.repo-card:hover .repo-card-badge-learn`, `.repo-card:hover .repo-card-badge-br.starred` (lines ~1969–1971)
- 7/8-col `.repo-card-dither` height override (lines ~10419–10422). The new RepoCard doesn't use `.repo-card-dither`. If you want adaptive height on the new image area at narrow column counts, replace the rule with:
  ```css
  .discover-grid[data-cols="7"] .repo-card-image,
  .discover-grid[data-cols="8"] .repo-card-image {
    height: 120px;
  }
  ```
  Otherwise just delete the block. Choose: replace (smaller image at 7/8 cols) or delete (uniform 140px everywhere). Recommendation: replace, since the old behaviour was intentional for compact layouts.

**Do NOT delete:** `.repo-card-top`, `.repo-card-top-text`, `.repo-card-avatar`, `.repo-card-name`, `.repo-card-desc`, `.repo-card-grow`, `.repo-card-footer`, `.repo-card-footer-left`, `.repo-card-footer-badges`, `.repo-card-stats`, `.repo-card-stat`, `.repo-card-stat-owner`, `.repo-card-stat-owner:hover`, `.repo-card-tags`, `.repo-card-tag`, `.repo-card-tag:not(.active):hover`, `.repo-card-tag.active`, `.repo-card-tag.active:hover`, `.repo-card-icon-badge`, `.repo-card-icon-badge-icon`, `.repo-card-icon-badge-icon > span[style]`, `.repo-card-icon-badge-text`, `.repo-card-icon-badge-icon:hover ~ .repo-card-icon-badge-text`, `.repo-card-subtype-icon`, `.repo-card-subtype-icon svg`, `.repo-card-icon-badge svg`, `.repo-card-dither`, `.repo-card-info`, `.repo-card .install-btn`, `.repo-card .install-btn:hover`, `.repo-card-skeleton*`. These are consumed by other components.

Also remove the hover-state rules that target removed inner structure within `.repo-card:hover`:
- `.repo-card:hover .repo-card-tag` (line ~1950) — only RepoCard rendered tags, ForkRepoCard does not. **Safe to delete.**

Keep `.repo-card:hover .repo-card-stat-owner`, `.repo-card:hover .repo-card-name`, `.repo-card:hover .repo-card-desc`, `.repo-card:hover .repo-card-tag.active`, `.repo-card:hover .repo-card-footer`, `.repo-card:hover .repo-card-stat` — ForkRepoCard depends on these via its `.repo-card` parent class.

- [ ] **Step 2: Run tests**

Run: `npm test -- --run`
Expected: PASS.

- [ ] **Step 3: Visual smoke check — type check**

Run: `npx tsc --noEmit`
Expected: no errors. (If TypeScript flags any unused imports the user prefers to clean now, fix them; otherwise leave for a follow-up.)

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "style(card): delete dead .repo-card-* CSS exclusive to old RepoCard"
```

---

## Task 9: Remove dead `CardTags` helper (cleanup)

**Files:**
- Modify: `src/components/RepoCard.tsx` (already done in Task 3 — verify `CardTags` is gone) — no further action expected here, but Task 9 verifies one last time that `CardTags` is unreferenced repo-wide and stays deleted from RepoCard.

- [ ] **Step 1: Confirm `CardTags` is unreferenced**

Run: `npm test -- --run` (sanity)
Then grep:

Use the Grep tool with pattern `CardTags` across `src/` — expected: zero matches. If there are matches outside `src/components/RepoCard.tsx`, investigate and decide whether to leave `CardTags` defined elsewhere or migrate those callers. If RepoCard.tsx is the only place and `CardTags` was deleted in Task 3, this task is a no-op confirmation.

- [ ] **Step 2: If confirmed clean, no commit needed**

Skip the commit if there's nothing to change. If you noticed an orphan reference, fix it and commit:

```bash
git add <files>
git commit -m "chore(card): remove final CardTags reference"
```

---

## Verification (after all tasks)

- [ ] Run the full test suite: `npm test -- --run` — all green.
- [ ] Run TypeScript check: `npx tsc --noEmit` — no errors.
- [ ] Hand off to user for visual confirmation. Per project preference, do NOT launch the dev server — the user verifies UI changes themselves.

## Self-review checklist (executed during plan writing)

- ✅ Spec coverage: every "What's removed" item maps to a removal in Task 3 (RepoCard) or Task 6 (DiscoverRow); every new visual element from "Final layout" appears in the new JSX and CSS.
- ✅ Placeholder scan: no "TBD"/"TODO"/"add appropriate X" in steps; every code block is complete.
- ✅ Type consistency: `RepoCardProps` shape matches between Task 2 test types, Task 3 implementation, and Task 4 caller. `LearnState` literal type is identical. Class names match across CSS (Task 1) and JSX (Tasks 3, 6).
- ✅ Spec adjustment captured: `.repo-card-desc` is preserved (used by ForkRepoCard); new cards use `.repo-card-description`. CSS deletions narrowed to confirmed-orphan classes only. `.repo-card-dither` retained for ForkRepoCard with a new `.repo-card-image` introduced for the new design.
