# Activity Feed — Banner Cards & Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Steam-style activity feed redesign described in [the spec](../specs/2026-04-29-activity-feed-banner-cards-design.md): banner cards for releases and merged PRs, date-divider grouping, and a click-through modal with full notes, diff stats, and action buttons.

**Architecture:** Replace `ReleaseEventCard` with a generic visual `BannerCard` shell driven by structured props. Type-branching and prop-shaping live in `ActivityEvent.tsx`'s render function via small inline adapters (`releaseToBannerProps`, `pullRequestToBannerProps`). A new `ActivityModal` frame owns the click-through experience and delegates body rendering to per-event-type content components (`ReleaseModalContent`, `PullRequestModalContent`). `ActivityFeed` groups events by local-day and owns the modal-open state.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, Electron IPC (`window.api.github.*`), existing components (`DitherBackground`, `ReadmeRenderer`, `CompareSummary`), existing utils (`parseCompareUrl`/`stripCompareLine` from `src/utils/parseCompareUrl.ts`, `relativeTime` from `src/utils/relativeTime.ts`).

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/utils/parseSemverTag.ts` | Create | Parse `v1.2.3-rc.1` → `{ major, minor, patch, prerelease }` |
| `src/utils/parseSemverTag.test.ts` | Create | Unit tests |
| `src/utils/classifyRelease.ts` | Create | Tag + prerelease flag → `'major' \| 'normal' \| 'prerelease'` |
| `src/utils/classifyRelease.test.ts` | Create | Unit tests |
| `src/utils/stripMarkdownPreview.ts` | Create | Markdown body → plain-text preview, capped at maxLength |
| `src/utils/stripMarkdownPreview.test.ts` | Create | Unit tests |
| `src/utils/groupEventsByDay.ts` | Create | Events → `{ label, events }[]` grouped by local-day |
| `src/utils/groupEventsByDay.test.ts` | Create | Unit tests |
| `electron/github.ts` | Modify | Extend `GitHubRelease` (`prerelease`), `GitHubEventPayload` ReleaseEvent (`prerelease`) and PullRequestEvent (`body`, `number`, `user`, `base`, `head`) |
| `src/hooks/useFeed.ts` | Modify | Carry `prerelease` flag through synthesized release events |
| `src/components/DateDivider.tsx` | Create | Label + horizontal rule |
| `src/components/DateDivider.css` | Create | Styles |
| `src/components/DateDivider.test.tsx` | Create | Component tests |
| `src/components/BannerCard.tsx` | Create | Visual shell — banner image (Dither) + body + meta |
| `src/components/BannerCard.css` | Create | Styles incl. `--major`/`--prerelease` variants |
| `src/components/BannerCard.test.tsx` | Create | Component tests |
| `src/components/ReleaseModalContent.tsx` | Create | Release body — `ReadmeRenderer` + conditional `CompareSummary` |
| `src/components/ReleaseModalContent.test.tsx` | Create | Component tests |
| `src/components/PullRequestModalContent.tsx` | Create | PR body — `ReadmeRenderer` + `CompareSummary` |
| `src/components/PullRequestModalContent.test.tsx` | Create | Component tests |
| `src/components/ActivityModal.tsx` | Create | Modal frame — banner hero + header + body slot + footer |
| `src/components/ActivityModal.css` | Create | Styles |
| `src/components/ActivityModal.test.tsx` | Create | Component tests (Esc, backdrop click, footer behaviour) |
| `src/components/ActivityEvent.tsx` | Modify | Replace `<ReleaseEventCard>` branch with `<BannerCard>` + add PR branch; accept `onOpenModal` prop |
| `src/components/ActivityEvent.test.tsx` | Modify | Update mocks + add PR branch test + onOpenModal test |
| `src/components/ActivityFeed.tsx` | Modify | Group events by day, render dividers, host modal state |
| `src/components/ReleaseEventCard.tsx` | Delete | Replaced by BannerCard + adapter |
| `src/components/ReleaseEventCard.css` | Delete | Replaced |
| `src/components/ReleaseEventCard.test.tsx` | Delete | Replaced |

---

## Important Notes for the Executor

### PR event filtering already happens in the main process

The spec mentions filtering `PullRequestEvent` to merged-only — **this filter already exists** in `electron/github.ts` inside `mapReceivedEvents()` (around line 118):

```ts
if (e.type === 'PullRequestEvent') {
  const pr = e.payload as { action?: string; pull_request?: { merged?: boolean } }
  return pr.action === 'closed' && pr.pull_request?.merged === true
}
```

Do **not** add a duplicate filter in `useFeed.ts`. Verify the existing filter is in place during Task 5; if it has been removed for any reason, restore it in that task.

### Working directly on main

Per project policy (CLAUDE.md), this work commits directly to `main` — no feature branch, no worktree. Each task ends in a commit on `main`.

### Test commands

- Run a single test file: `npx vitest run path/to/file.test.ts`
- Run all tests: `npx vitest run`

### Line numbers reference HEAD as of plan-write time

`useFeed.ts`, `ActivityEvent.tsx`, and `electron/github.ts` are all clean and committed at HEAD `64b040c`. If any of these files have been modified between plan write and execution, the executor should `git log -- <file>` to see what changed and re-anchor on structural references (function names, exports, imports) rather than literal line numbers.

---

## Task 1: `parseSemverTag` util

**Files:**
- Create: `src/utils/parseSemverTag.ts`
- Create: `src/utils/parseSemverTag.test.ts`

### Background

Pure function. No deps. Strips a leading `v` from a tag (e.g. `v1.2.3` → `1.2.3`), then matches `^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$` (case-insensitive). Returns `null` on no match — the caller treats `null` as "tag not semver, classify as normal update".

- [ ] **Step 1: Write the failing tests**

Create `src/utils/parseSemverTag.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseSemverTag } from './parseSemverTag'

describe('parseSemverTag', () => {
  it('parses a basic v-prefixed tag', () => {
    expect(parseSemverTag('v1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
  })

  it('parses a tag without v prefix', () => {
    expect(parseSemverTag('1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
  })

  it('parses a prerelease suffix', () => {
    expect(parseSemverTag('v2.0.0-rc.1')).toEqual({
      major: 2, minor: 0, patch: 0, prerelease: 'rc.1',
    })
  })

  it('parses a complex prerelease string', () => {
    expect(parseSemverTag('v1.0.0-alpha.10.beta-2')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: 'alpha.10.beta-2',
    })
  })

  it('parses 0.x as semver (major=0)', () => {
    expect(parseSemverTag('v0.5.0')).toEqual({
      major: 0, minor: 5, patch: 0, prerelease: null,
    })
  })

  it('parses 1.0.0 (the canonical major bump)', () => {
    expect(parseSemverTag('1.0.0')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: null,
    })
  })

  it('returns null for non-semver tags', () => {
    expect(parseSemverTag('release-2024-04')).toBeNull()
    expect(parseSemverTag('build-7654')).toBeNull()
    expect(parseSemverTag('next')).toBeNull()
    expect(parseSemverTag('')).toBeNull()
    expect(parseSemverTag('v1.2')).toBeNull() // missing patch
    expect(parseSemverTag('v1')).toBeNull()   // missing minor + patch
  })

  it('is case-insensitive on the v prefix and prerelease', () => {
    expect(parseSemverTag('V1.2.3')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: null,
    })
    expect(parseSemverTag('v1.0.0-RC.1')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: 'RC.1',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/parseSemverTag.test.ts
```

Expected: All tests fail with "Cannot find module './parseSemverTag'".

- [ ] **Step 3: Implement `parseSemverTag`**

Create `src/utils/parseSemverTag.ts`:

```typescript
export interface SemverParts {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/i

export function parseSemverTag(tag: string): SemverParts | null {
  if (!tag) return null
  const match = tag.match(SEMVER_RE)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/parseSemverTag.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/parseSemverTag.ts src/utils/parseSemverTag.test.ts
git commit -m "feat(util): add parseSemverTag for release tag classification"
```

---

## Task 2: `classifyRelease` util

**Files:**
- Create: `src/utils/classifyRelease.ts`
- Create: `src/utils/classifyRelease.test.ts`

### Background

Composes `parseSemverTag` with the GitHub `prerelease` flag to return the tier used by `BannerCard`. Rules (in order, first match wins):

1. `prereleaseFlag === true` → `'prerelease'`
2. Semver parses and `parts.prerelease === null` and `major >= 1 && minor === 0 && patch === 0` → `'major'`
3. Otherwise → `'normal'`

Note that a semver tag with a non-null prerelease (e.g. `v1.0.0-rc.1`) does **not** count as major — it's prerelease only if the GitHub flag says so, otherwise normal.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/classifyRelease.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyRelease } from './classifyRelease'

describe('classifyRelease', () => {
  it('returns prerelease when the flag is true', () => {
    expect(classifyRelease({ tagName: 'v2.0.0', prereleaseFlag: true })).toBe('prerelease')
    expect(classifyRelease({ tagName: 'v1.2.3', prereleaseFlag: true })).toBe('prerelease')
    expect(classifyRelease({ tagName: 'release-2024', prereleaseFlag: true })).toBe('prerelease')
  })

  it('returns major for x.0.0 tags with major>=1 and no prerelease suffix', () => {
    expect(classifyRelease({ tagName: 'v1.0.0', prereleaseFlag: false })).toBe('major')
    expect(classifyRelease({ tagName: 'v2.0.0', prereleaseFlag: false })).toBe('major')
    expect(classifyRelease({ tagName: '5.0.0', prereleaseFlag: false })).toBe('major')
  })

  it('returns normal for minor/patch bumps', () => {
    expect(classifyRelease({ tagName: 'v1.2.0', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v1.2.3', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v0.5.0', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for 0.x.0 (0.x is not "major")', () => {
    expect(classifyRelease({ tagName: 'v0.0.0', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'v0.1.0', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for major-with-prerelease-suffix when flag is false', () => {
    // Caller decides via the flag, but this verifies the rule precedence.
    expect(classifyRelease({ tagName: 'v1.0.0-rc.1', prereleaseFlag: false })).toBe('normal')
  })

  it('returns normal for non-semver tags', () => {
    expect(classifyRelease({ tagName: 'release-2024-04', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: 'next', prereleaseFlag: false })).toBe('normal')
    expect(classifyRelease({ tagName: '', prereleaseFlag: false })).toBe('normal')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/classifyRelease.test.ts
```

Expected: All tests fail with "Cannot find module './classifyRelease'".

- [ ] **Step 3: Implement `classifyRelease`**

Create `src/utils/classifyRelease.ts`:

```typescript
import { parseSemverTag } from './parseSemverTag'

export type ReleaseTier = 'major' | 'normal' | 'prerelease'

export function classifyRelease(opts: {
  tagName: string
  prereleaseFlag: boolean
}): ReleaseTier {
  if (opts.prereleaseFlag) return 'prerelease'
  const parts = parseSemverTag(opts.tagName)
  if (
    parts !== null &&
    parts.prerelease === null &&
    parts.major >= 1 &&
    parts.minor === 0 &&
    parts.patch === 0
  ) {
    return 'major'
  }
  return 'normal'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/classifyRelease.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/classifyRelease.ts src/utils/classifyRelease.test.ts
git commit -m "feat(util): add classifyRelease for major/normal/prerelease tiering"
```

---

## Task 3: `stripMarkdownPreview` util

**Files:**
- Create: `src/utils/stripMarkdownPreview.ts`
- Create: `src/utils/stripMarkdownPreview.test.ts`

### Background

Used by the release/PR adapters in `ActivityEvent.tsx` to feed a plain-text 2-line preview into `BannerCard`. CSS line-clamp handles visual truncation — `maxLength` is a safety cap to avoid stuffing kilobytes into the DOM.

Reuses the existing `stripCompareLine` helper exported from `src/utils/parseCompareUrl.ts` to remove the auto-generated `**Full Changelog**: ...` line first, then strips markdown formatting and collapses whitespace.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/stripMarkdownPreview.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { stripMarkdownPreview } from './stripMarkdownPreview'

describe('stripMarkdownPreview', () => {
  it('returns empty string for empty input', () => {
    expect(stripMarkdownPreview('', 200)).toBe('')
  })

  it('strips heading markers but keeps the text', () => {
    expect(stripMarkdownPreview('# Title\nbody', 200)).toBe('Title body')
    expect(stripMarkdownPreview('### Subhead', 200)).toBe('Subhead')
  })

  it('strips emphasis markers', () => {
    expect(stripMarkdownPreview('**bold** and *italic* and __underline__', 200))
      .toBe('bold and italic and underline')
  })

  it('strips link wrappers and keeps the link text', () => {
    expect(stripMarkdownPreview('See [the docs](https://example.com) for more', 200))
      .toBe('See the docs for more')
  })

  it('strips images entirely', () => {
    expect(stripMarkdownPreview('Hello ![logo](logo.png) world', 200))
      .toBe('Hello world')
  })

  it('strips fenced code blocks', () => {
    expect(stripMarkdownPreview('intro\n```js\nconst x = 1\n```\noutro', 200))
      .toBe('intro outro')
  })

  it('strips inline code, keeping the inner text', () => {
    expect(stripMarkdownPreview('Use `useEffect` for side effects', 200))
      .toBe('Use useEffect for side effects')
  })

  it('collapses runs of whitespace and newlines to a single space', () => {
    expect(stripMarkdownPreview('a\n\n\nb\t\tc   d', 200)).toBe('a b c d')
  })

  it('removes the auto-generated Full Changelog line', () => {
    const input = 'Notes\n\n**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0'
    expect(stripMarkdownPreview(input, 200)).toBe('Notes')
  })

  it('truncates at maxLength on a word boundary when possible', () => {
    const input = 'one two three four five six seven eight'
    const out = stripMarkdownPreview(input, 18)
    expect(out.length).toBeLessThanOrEqual(18)
    expect(out).toBe('one two three four')
  })

  it('truncates mid-word when no whitespace before maxLength', () => {
    const input = 'supercalifragilisticexpialidocious'
    const out = stripMarkdownPreview(input, 10)
    expect(out).toBe('supercalif')
  })

  it('returns trimmed text under maxLength unchanged', () => {
    expect(stripMarkdownPreview('  short body  ', 200)).toBe('short body')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/stripMarkdownPreview.test.ts
```

Expected: All tests fail with "Cannot find module './stripMarkdownPreview'".

- [ ] **Step 3: Implement `stripMarkdownPreview`**

Create `src/utils/stripMarkdownPreview.ts`:

```typescript
import { stripCompareLine } from './parseCompareUrl'

export function stripMarkdownPreview(body: string, maxLength: number): string {
  if (!body) return ''

  let text = stripCompareLine(body)

  // Strip fenced code blocks first (they may contain other markdown chars).
  text = text.replace(/```[\s\S]*?```/g, ' ')

  // Strip images: ![alt](url) → ''
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // Replace links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Strip leading heading markers on each line.
  text = text.replace(/^\s*#{1,6}\s+/gm, '')

  // Strip emphasis markers (preserve inner text).
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Inline code: `code` → code
  text = text.replace(/`([^`]+)`/g, '$1')

  // Collapse all whitespace runs to a single space.
  text = text.replace(/\s+/g, ' ').trim()

  if (text.length <= maxLength) return text

  // Truncate to maxLength, preferring the last word boundary.
  const slice = text.slice(0, maxLength)
  const lastSpace = slice.lastIndexOf(' ')
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/stripMarkdownPreview.test.ts
```

Expected: All 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/stripMarkdownPreview.ts src/utils/stripMarkdownPreview.test.ts
git commit -m "feat(util): add stripMarkdownPreview for banner card description text"
```

---

## Task 4: `groupEventsByDay` util

**Files:**
- Create: `src/utils/groupEventsByDay.ts`
- Create: `src/utils/groupEventsByDay.test.ts`

### Background

Buckets events by **local-time** calendar date (using `Date.toDateString()` as the bucket key — the local-time representation makes "today" align with the user's wall clock, not UTC). Iterates input order to preserve the existing chronological-descending sort from `useFeed`.

Label rules (computed against an injected `now` so tests are deterministic):
- Same day as `now` → `'Today'`
- Day before `now` → `'Yesterday'`
- Same calendar year as `now` → `'April 25'` (month name + day, English)
- Different calendar year → `'April 25, 2025'`

Uses `Intl.DateTimeFormat` with explicit options — already the project's pattern. The `'en-US'` locale produces the desired month-name format.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/groupEventsByDay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupEventsByDay } from './groupEventsByDay'
import type { GitHubFeedEvent } from '../hooks/useFeed'

function makeEvent(id: string, isoTimestamp: string): GitHubFeedEvent {
  return {
    id,
    type: 'WatchEvent',
    actor: { login: 'a', avatar_url: '' },
    repo: { full_name: 'a/b' },
    payload: {},
    created_at: isoTimestamp,
  }
}

describe('groupEventsByDay', () => {
  // Use a fixed local-time anchor: 2026-04-30 14:00 local
  const now = new Date(2026, 3, 30, 14, 0, 0) // month is 0-indexed (3 = April)

  it('returns empty array for empty input', () => {
    expect(groupEventsByDay([], now)).toEqual([])
  })

  it('labels todays events as Today', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 30, 13, 0, 0).toISOString()),
      makeEvent('2', new Date(2026, 3, 30, 9, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Today')
    expect(groups[0].events).toHaveLength(2)
  })

  it('labels yesterdays events as Yesterday', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 29, 23, 30, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('Yesterday')
  })

  it('labels older same-year dates as Month Day', () => {
    const events = [
      makeEvent('1', new Date(2026, 3, 25, 12, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('April 25')
  })

  it('labels prior-year dates with year suffix', () => {
    const events = [
      makeEvent('1', new Date(2025, 11, 31, 12, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups[0].label).toBe('December 31, 2025')
  })

  it('preserves group order based on first occurrence in input', () => {
    const events = [
      makeEvent('today1', new Date(2026, 3, 30, 13, 0, 0).toISOString()),
      makeEvent('yesterday1', new Date(2026, 3, 29, 11, 0, 0).toISOString()),
      makeEvent('today2', new Date(2026, 3, 30, 9, 0, 0).toISOString()),
      makeEvent('apr25', new Date(2026, 3, 25, 8, 0, 0).toISOString()),
    ]
    const groups = groupEventsByDay(events, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'April 25'])
    expect(groups[0].events.map(e => e.id)).toEqual(['today1', 'today2'])
    expect(groups[1].events.map(e => e.id)).toEqual(['yesterday1'])
    expect(groups[2].events.map(e => e.id)).toEqual(['apr25'])
  })

  it('treats events on either side of midnight as different days', () => {
    const lateYesterday = new Date(2026, 3, 29, 23, 59, 59).toISOString()
    const earlyToday = new Date(2026, 3, 30, 0, 0, 30).toISOString()
    const groups = groupEventsByDay([
      makeEvent('earlyToday', earlyToday),
      makeEvent('lateYesterday', lateYesterday),
    ], now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/groupEventsByDay.test.ts
```

Expected: All tests fail with "Cannot find module './groupEventsByDay'".

- [ ] **Step 3: Implement `groupEventsByDay`**

Create `src/utils/groupEventsByDay.ts`:

```typescript
import type { GitHubFeedEvent } from '../hooks/useFeed'

export interface EventGroup {
  label: string
  events: GitHubFeedEvent[]
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
})

function dayKey(d: Date): string {
  return d.toDateString() // local-time, stable per-day key
}

function labelFor(eventDate: Date, now: Date): string {
  const todayKey = dayKey(now)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const eventKey = dayKey(eventDate)

  if (eventKey === todayKey) return 'Today'
  if (eventKey === dayKey(yesterday)) return 'Yesterday'
  if (eventDate.getFullYear() === now.getFullYear()) {
    return MONTH_DAY.format(eventDate)
  }
  return MONTH_DAY_YEAR.format(eventDate)
}

export function groupEventsByDay(
  events: GitHubFeedEvent[],
  now: Date = new Date(),
): EventGroup[] {
  const groups: EventGroup[] = []
  const indexByKey = new Map<string, number>()

  for (const event of events) {
    const date = new Date(event.created_at)
    const key = dayKey(date)
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = groups.length
      indexByKey.set(key, idx)
      groups.push({ label: labelFor(date, now), events: [] })
    }
    groups[idx].events.push(event)
  }

  return groups
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/groupEventsByDay.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/groupEventsByDay.ts src/utils/groupEventsByDay.test.ts
git commit -m "feat(util): add groupEventsByDay for date-divider feed sectioning"
```

---

## Task 5: Extend GitHub event payload types

**Files:**
- Modify: `electron/github.ts`

### Background

The renderer needs more fields off the release and PR payloads to drive the new cards and modals. The actual GitHub API responses already contain these fields — they're spread into the typed payload via `payload: { type: e.type, ...e.payload } as GitHubEventPayload` in `mapReceivedEvents()` (around line 130). Declaring them in the type makes them available to TypeScript without changing runtime behaviour.

For releases:
- `prerelease: boolean` on `GitHubRelease` (used by `getReleases` repo-API path)
- `prerelease?: boolean | null` on the `ReleaseEvent` payload type (received_events path)

For PRs (received_events only):
- `pull_request.number: number`
- `pull_request.body?: string | null`
- `pull_request.user: { login: string; avatar_url: string }`
- `pull_request.base: { sha: string; ref: string }`
- `pull_request.head: { sha: string; ref: string }`

**Verify the existing PR merged-only filter is intact.** Around `electron/github.ts:118-124` you should see:

```ts
if (e.type === 'PullRequestEvent') {
  const pr = e.payload as { action?: string; pull_request?: { merged?: boolean } }
  return pr.action === 'closed' && pr.pull_request?.merged === true
}
```

If it's missing, restore it as part of this task.

- [ ] **Step 1: Read the file at HEAD to anchor on the structure**

```bash
sed -n '40,100p' electron/github.ts
```

Confirm:
- `GitHubRelease` interface starts around line 48
- `GitHubEventPayload` discriminated union starts around line 86
- `mapReceivedEvents` PR filter is around line 118

- [ ] **Step 2: Add tests for the type extensions in `electron/github.test.ts`**

Open `electron/github.test.ts`. Add a new `describe` block at the bottom (do not replace existing content):

```typescript
describe('payload type surface', () => {
  it('GitHubRelease carries prerelease flag', () => {
    const r: import('./github').GitHubRelease = {
      tag_name: 'v1.0.0',
      name: null,
      published_at: new Date().toISOString(),
      body: null,
      assets: [],
      prerelease: true,
    }
    expect(r.prerelease).toBe(true)
  })

  it('ReleaseEvent payload exposes prerelease flag', () => {
    const p: import('./github').GitHubEventPayload = {
      type: 'ReleaseEvent',
      action: 'published',
      release: { tag_name: 'v2.0.0', name: 'Two', body: null, prerelease: false },
    }
    if (p.type === 'ReleaseEvent') {
      expect(p.release.prerelease).toBe(false)
    }
  })

  it('PullRequestEvent payload exposes number, body, user, base, and head', () => {
    const p: import('./github').GitHubEventPayload = {
      type: 'PullRequestEvent',
      action: 'closed',
      pull_request: {
        merged: true,
        title: 'Fix it',
        number: 1234,
        body: 'Body markdown',
        user: { login: 'alice', avatar_url: 'https://example.com/a.png' },
        base: { sha: 'aaa', ref: 'main' },
        head: { sha: 'bbb', ref: 'feature' },
      },
    }
    if (p.type === 'PullRequestEvent') {
      expect(p.pull_request.number).toBe(1234)
      expect(p.pull_request.base.sha).toBe('aaa')
      expect(p.pull_request.head.ref).toBe('feature')
    }
  })
})
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
npx vitest run electron/github.test.ts -t "payload type surface"
```

Expected: All 3 tests fail with TypeScript errors about missing properties.

- [ ] **Step 4: Extend the types**

Edit `electron/github.ts`. Find the `GitHubRelease` interface and add `prerelease`:

```typescript
export interface GitHubRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  assets: GitHubReleaseAsset[]
  prerelease: boolean
}
```

Find the `GitHubEventPayload` discriminated union and update both the `ReleaseEvent` and `PullRequestEvent` variants:

```typescript
export type GitHubEventPayload =
  | { type: 'WatchEvent'; action: 'started' }
  | { type: 'ForkEvent'; forkee: { full_name: string } }
  | {
      type: 'ReleaseEvent'
      action: 'published'
      release: {
        tag_name: string
        name?: string | null
        body?: string | null
        prerelease?: boolean | null
      }
    }
  | {
      type: 'PullRequestEvent'
      action: 'closed'
      pull_request: {
        merged: boolean
        title: string
        number: number
        body?: string | null
        user: { login: string; avatar_url: string }
        base: { sha: string; ref: string }
        head: { sha: string; ref: string }
      }
    }
```

- [ ] **Step 5: Verify the merged-only PR filter is intact**

Open `electron/github.ts` and check around line 118 for the filter inside `mapReceivedEvents`. Run:

```bash
grep -n "PullRequestEvent" electron/github.ts
```

Expected: filter block present in `mapReceivedEvents`. If missing, restore from spec text.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run electron/github.test.ts
```

Expected: All tests pass (existing + new 3).

- [ ] **Step 7: Commit**

```bash
git add electron/github.ts electron/github.test.ts
git commit -m "feat(github): extend payload types for release prerelease + PR detail fields"
```

---

## Task 6: Carry `prerelease` flag through `useFeed` synthesized release events

**Files:**
- Modify: `src/hooks/useFeed.ts`

### Background

The repo-API path (around line 76) synthesizes release events from `getReleases()` results into the same shape as received_events. We need to include `prerelease` so `classifyRelease` can use it downstream. The `received` path already has the field (it'll flow through after Task 5 type extension; runtime spread already includes it).

- [ ] **Step 1: Add a test for the synthesized payload carrying `prerelease`**

There is no existing `useFeed.test.ts`. Adding one for this feature is overkill (the hook is integration-heavy and tested via consumer components elsewhere). Instead, add a single targeted test in a new `src/hooks/useFeed.test.ts` that asserts the synthesized event payload shape. Create it:

```typescript
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mockGetReceivedEvents = vi.fn()
const mockGetFeedRepos = vi.fn()
const mockGetReleases = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: {
      github: {
        getReceivedEvents: mockGetReceivedEvents,
        getFeedRepos: mockGetFeedRepos,
        getReleases: mockGetReleases,
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: { login: 'octocat' } }),
}))

const { useFeed } = await import('./useFeed')

describe('useFeed synthesized releases', () => {
  it('carries prerelease flag from getReleases into the event payload', async () => {
    mockGetReceivedEvents.mockResolvedValue([])
    mockGetFeedRepos.mockResolvedValue([{ owner: 'a', name: 'b' }])
    mockGetReleases.mockResolvedValue([
      {
        tag_name: 'v1.0.0-rc.1',
        name: 'RC',
        published_at: new Date().toISOString(),
        body: 'notes',
        assets: [],
        prerelease: true,
      },
    ])

    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.events).toHaveLength(1))

    const event = result.current.events[0]
    expect(event.type).toBe('ReleaseEvent')
    const release = (event.payload as { release: { prerelease?: boolean } }).release
    expect(release.prerelease).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/hooks/useFeed.test.ts
```

Expected: Test fails — the synthesized payload at line 76 of `useFeed.ts` does not include `prerelease`.

- [ ] **Step 3: Add `prerelease` to the synthesized payload**

In `src/hooks/useFeed.ts` find the synthesized release map (around line 76):

```ts
payload: { release: { tag_name: r.tag_name, name: r.name, body: r.body } },
```

Replace with:

```ts
payload: { release: { tag_name: r.tag_name, name: r.name, body: r.body, prerelease: r.prerelease } },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/hooks/useFeed.test.ts
```

Expected: Test passes.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFeed.ts src/hooks/useFeed.test.ts
git commit -m "feat(feed): carry prerelease flag through synthesized release events"
```

---

## Task 7: `DateDivider` component

**Files:**
- Create: `src/components/DateDivider.tsx`
- Create: `src/components/DateDivider.css`
- Create: `src/components/DateDivider.test.tsx`

### Background

Tiny presentational component. The label string is provided pre-formatted by `groupEventsByDay` ("Today", "April 25", etc.) — `DateDivider` does not transform it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/DateDivider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DateDivider } from './DateDivider'

describe('DateDivider', () => {
  it('renders the label', () => {
    render(<DateDivider label="Today" />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders the rule line', () => {
    const { container } = render(<DateDivider label="April 25" />)
    expect(container.querySelector('.date-divider__line')).toBeInTheDocument()
  })

  it('passes through the exact label without case transformation', () => {
    render(<DateDivider label="April 25, 2025" />)
    expect(screen.getByText('April 25, 2025')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/DateDivider.test.tsx
```

Expected: All 3 tests fail with "Cannot find module './DateDivider'".

- [ ] **Step 3: Create the CSS**

Create `src/components/DateDivider.css`:

```css
.date-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px 12px;
}

.date-divider__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--t3);
  flex-shrink: 0;
}

.date-divider__line {
  flex: 1;
  height: 1px;
  background: var(--border);
}
```

- [ ] **Step 4: Create the component**

Create `src/components/DateDivider.tsx`:

```tsx
import './DateDivider.css'

interface Props {
  label: string
}

export function DateDivider({ label }: Props) {
  return (
    <div className="date-divider">
      <span className="date-divider__label">{label}</span>
      <span className="date-divider__line" />
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/components/DateDivider.test.tsx
```

Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/DateDivider.tsx src/components/DateDivider.css src/components/DateDivider.test.tsx
git commit -m "feat(feed): add DateDivider component for grouped event sections"
```

---

## Task 8: `BannerCard` component

**Files:**
- Create: `src/components/BannerCard.tsx`
- Create: `src/components/BannerCard.css`
- Create: `src/components/BannerCard.test.tsx`

### Background

Visual shell driven by structured props — does not know about event types or GitHub payloads. Renders the `DitherBackground` (existing component, accepts `avatarUrl`, `fallbackGradient`, `staticFrame`) plus the version label overlay, then a body column with tag, title, description, and meta row.

`relativeTime` is exported from `src/utils/relativeTime.ts`.

`DitherBackground` is the **default export** of `src/components/DitherBackground.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/BannerCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BannerCard } from './BannerCard'

// DitherBackground uses canvas + ResizeObserver; mock to a simple stub for tests.
vi.mock('./DitherBackground', () => ({
  default: ({ avatarUrl }: { avatarUrl?: string }) => (
    <div data-testid="dither" data-avatar={avatarUrl ?? ''} />
  ),
}))

const baseProps = {
  tag: 'UPDATE',
  tier: 'normal' as const,
  title: 'v1.2.3 — Bug fixes',
  descriptionPreview: 'Fixes some bugs',
  versionLabel: 'v1.2.3',
  ownerLogin: 'vitejs',
  repoFullName: 'vitejs/vite',
  occurredAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago
  onClick: vi.fn(),
}

describe('BannerCard', () => {
  it('renders the tag, title, and description', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('UPDATE')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3 — Bug fixes')).toBeInTheDocument()
    expect(screen.getByText('Fixes some bugs')).toBeInTheDocument()
  })

  it('renders the version label as overlay', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
  })

  it('renders the repo full name and a relative timestamp', () => {
    render(<BannerCard {...baseProps} />)
    expect(screen.getByText('vitejs/vite')).toBeInTheDocument()
    expect(screen.getByText(/5h ago/)).toBeInTheDocument()
  })

  it('passes the owner avatar URL into DitherBackground', () => {
    render(<BannerCard {...baseProps} />)
    const dither = screen.getByTestId('dither')
    expect(dither.getAttribute('data-avatar')).toContain('github.com/vitejs.png')
  })

  it('applies the major modifier class for tier=major', () => {
    const { container } = render(<BannerCard {...baseProps} tier="major" tag="MAJOR UPDATE" />)
    expect(container.querySelector('.banner-card--major')).toBeInTheDocument()
    expect(container.querySelector('.banner-card__tag--major')).toBeInTheDocument()
  })

  it('applies the prerelease modifier class for tier=prerelease', () => {
    const { container } = render(<BannerCard {...baseProps} tier="prerelease" tag="PRE-RELEASE" />)
    expect(container.querySelector('.banner-card__tag--prerelease')).toBeInTheDocument()
  })

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<BannerCard {...baseProps} onClick={onClick} />)
    fireEvent.click(container.querySelector('.banner-card')!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/BannerCard.test.tsx
```

Expected: All 7 tests fail with "Cannot find module './BannerCard'".

- [ ] **Step 3: Create the CSS**

Create `src/components/BannerCard.css`:

```css
.banner-card {
  display: flex;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin: 0 16px 10px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.banner-card:hover {
  border-color: var(--border2);
}

.banner-card--major {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 1px var(--accent-border) inset;
}

.banner-card--major:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}

.banner-card__image {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg3);
  position: relative;
  overflow: hidden;
}

.banner-card__version-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.96);
  font-weight: 700;
  font-size: 24px;
  letter-spacing: 0.04em;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

.banner-card__body {
  flex: 1;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.banner-card__tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--t3);
  margin-bottom: 1px;
}

.banner-card__tag--major {
  color: var(--accent-text);
}

.banner-card__tag--prerelease {
  color: #ffa657;
}

.banner-card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--t1);
  line-height: 1.3;
}

.banner-card__desc {
  font-size: 13px;
  color: var(--t3);
  line-height: 1.45;
  margin: 4px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.banner-card__meta {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--t4);
  padding-top: 8px;
}

.banner-card__meta img {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.banner-card__meta strong {
  color: var(--t3);
  font-weight: 500;
}
```

- [ ] **Step 4: Create the component**

Create `src/components/BannerCard.tsx`:

```tsx
import DitherBackground from './DitherBackground'
import { relativeTime } from '../utils/relativeTime'
import './BannerCard.css'

export type BannerCardTier = 'normal' | 'major' | 'prerelease'

interface BannerCardProps {
  tag: string
  tier: BannerCardTier
  title: string
  descriptionPreview: string
  versionLabel: string
  ownerLogin: string
  repoFullName: string
  occurredAt: string
  onClick: () => void
}

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

export function BannerCard({
  tag, tier, title, descriptionPreview, versionLabel,
  ownerLogin, repoFullName, occurredAt, onClick,
}: BannerCardProps) {
  return (
    <div className={`banner-card banner-card--${tier}`} onClick={onClick}>
      <div className="banner-card__image">
        <DitherBackground
          avatarUrl={`https://github.com/${ownerLogin}.png?size=200`}
          fallbackGradient={tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
          staticFrame
        />
        <div className="banner-card__version-overlay">{versionLabel}</div>
      </div>
      <div className="banner-card__body">
        <span className={`banner-card__tag banner-card__tag--${tier}`}>{tag}</span>
        <span className="banner-card__title">{title}</span>
        <p className="banner-card__desc">{descriptionPreview}</p>
        <div className="banner-card__meta">
          <img src={`https://github.com/${ownerLogin}.png?size=40`} alt="" />
          <strong>{repoFullName}</strong>
          <span>·</span>
          <span>{relativeTime(occurredAt)}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/components/BannerCard.test.tsx
```

Expected: All 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/BannerCard.tsx src/components/BannerCard.css src/components/BannerCard.test.tsx
git commit -m "feat(feed): add BannerCard visual shell for release/PR feed cards"
```

---

## Task 9: `ReleaseModalContent` component

**Files:**
- Create: `src/components/ReleaseModalContent.tsx`
- Create: `src/components/ReleaseModalContent.test.tsx`

### Background

Body content for a release modal: lazy `ReadmeRenderer` for the markdown body (after `stripCompareLine`), then `CompareSummary` if a compare URL is present in the body. Skipped silently if the body has no compare URL.

`ReadmeRenderer` is the default export of `src/components/ReadmeRenderer.tsx`. It accepts `content`, `repoOwner`, `repoName`.

`CompareSummary` is exported from `src/components/CompareSummary.tsx` and accepts `owner`, `repo`, `base`, `head`.

`parseCompareUrl` and `stripCompareLine` are both exported from `src/utils/parseCompareUrl.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ReleaseModalContent.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReleaseModalContent } from './ReleaseModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

// Stub ReadmeRenderer (lazy/Suspense + markdown engine is heavy in tests).
vi.mock('./ReadmeRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="readme">{content}</div>,
}))

// Stub CompareSummary so we can assert it received the right props.
vi.mock('./CompareSummary', () => ({
  CompareSummary: (props: Record<string, unknown>) => (
    <div data-testid="compare" data-base={props.base as string} data-head={props.head as string} />
  ),
}))

const makeEvent = (body: string): GitHubFeedEvent => ({
  id: '1',
  type: 'ReleaseEvent',
  actor: { login: 'maintainer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: { release: { tag_name: 'v1.2.3', name: 'v1.2.3', body } },
  created_at: new Date().toISOString(),
})

describe('ReleaseModalContent', () => {
  it('renders the markdown body via ReadmeRenderer', async () => {
    render(<ReleaseModalContent event={makeEvent('Some release notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme')).toHaveTextContent('Some release notes')
  })

  it('strips the Full Changelog line from the body before rendering', async () => {
    const body = 'Notes\n\n**Full Changelog**: https://github.com/acme/widget/compare/v1.2.2...v1.2.3'
    render(<ReleaseModalContent event={makeEvent(body)} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme').textContent).toBe('Notes')
  })

  it('renders CompareSummary when a compare URL is present', async () => {
    const body = 'Notes\n\n**Full Changelog**: https://github.com/acme/widget/compare/v1.2.2...v1.2.3'
    render(<ReleaseModalContent event={makeEvent(body)} />)
    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument())
    const compare = screen.getByTestId('compare')
    expect(compare.getAttribute('data-base')).toBe('v1.2.2')
    expect(compare.getAttribute('data-head')).toBe('v1.2.3')
  })

  it('does not render CompareSummary when no compare URL is in the body', async () => {
    render(<ReleaseModalContent event={makeEvent('Just plain notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByTestId('compare')).toBeNull()
  })

  it('handles missing body gracefully', async () => {
    const event: GitHubFeedEvent = {
      ...makeEvent(''),
      payload: { release: { tag_name: 'v1.2.3', name: 'v1.2.3', body: null } },
    }
    render(<ReleaseModalContent event={event} />)
    // No body → no readme content rendered
    await waitFor(() => {}, { timeout: 50 }).catch(() => {})
    expect(screen.queryByTestId('readme')?.textContent ?? '').toBe('')
    expect(screen.queryByTestId('compare')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/ReleaseModalContent.test.tsx
```

Expected: All tests fail with "Cannot find module './ReleaseModalContent'".

- [ ] **Step 3: Create the component**

Create `src/components/ReleaseModalContent.tsx`:

```tsx
import { lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { parseCompareUrl, stripCompareLine } from '../utils/parseCompareUrl'
import { CompareSummary } from './CompareSummary'

const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
  }
}

interface Props {
  event: GitHubFeedEvent
}

export function ReleaseModalContent({ event }: Props) {
  const release = (event.payload as ReleasePayload).release
  const rawBody = release.body ?? ''
  const compare = parseCompareUrl(rawBody)
  const body = compare ? stripCompareLine(rawBody) : rawBody

  const [owner, name] = event.repo.full_name.split('/')

  return (
    <>
      {body && (
        <Suspense fallback={<div className="activity-modal__body-fallback" />}>
          <ReadmeRenderer content={body} repoOwner={owner ?? ''} repoName={name ?? ''} />
        </Suspense>
      )}
      {compare && compare.kind === 'compare' && (
        <CompareSummary
          owner={compare.owner}
          repo={compare.repo}
          base={compare.base}
          head={compare.head}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/ReleaseModalContent.test.tsx
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReleaseModalContent.tsx src/components/ReleaseModalContent.test.tsx
git commit -m "feat(feed): add ReleaseModalContent for release modal body"
```

---

## Task 10: `PullRequestModalContent` component

**Files:**
- Create: `src/components/PullRequestModalContent.tsx`
- Create: `src/components/PullRequestModalContent.test.tsx`

### Background

Body content for a PR modal: lazy `ReadmeRenderer` for the PR body (no `stripCompareLine` needed — PR bodies don't have the auto-generated changelog line). Then `CompareSummary` using the PR's base/head SHAs.

- [ ] **Step 1: Write the failing tests**

Create `src/components/PullRequestModalContent.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PullRequestModalContent } from './PullRequestModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./ReadmeRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="readme">{content}</div>,
}))

vi.mock('./CompareSummary', () => ({
  CompareSummary: (props: Record<string, unknown>) => (
    <div
      data-testid="compare"
      data-owner={props.owner as string}
      data-repo={props.repo as string}
      data-base={props.base as string}
      data-head={props.head as string}
    />
  ),
}))

const makeEvent = (body: string | null): GitHubFeedEvent => ({
  id: '1',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: 'Fix the thing',
      number: 42,
      body,
      user: { login: 'contributor', avatar_url: '' },
      base: { sha: 'aaaa', ref: 'main' },
      head: { sha: 'bbbb', ref: 'feature' },
    },
  },
  created_at: new Date().toISOString(),
})

describe('PullRequestModalContent', () => {
  it('renders the PR body via ReadmeRenderer', async () => {
    render(<PullRequestModalContent event={makeEvent('PR body markdown')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByTestId('readme')).toHaveTextContent('PR body markdown')
  })

  it('renders CompareSummary using base/head SHAs and the repo from event.repo.full_name', () => {
    render(<PullRequestModalContent event={makeEvent('body')} />)
    const compare = screen.getByTestId('compare')
    expect(compare.getAttribute('data-owner')).toBe('acme')
    expect(compare.getAttribute('data-repo')).toBe('widget')
    expect(compare.getAttribute('data-base')).toBe('aaaa')
    expect(compare.getAttribute('data-head')).toBe('bbbb')
  })

  it('renders only CompareSummary when body is null', async () => {
    render(<PullRequestModalContent event={makeEvent(null)} />)
    expect(screen.queryByTestId('readme')).toBeNull()
    expect(screen.getByTestId('compare')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/PullRequestModalContent.test.tsx
```

Expected: All tests fail with "Cannot find module './PullRequestModalContent'".

- [ ] **Step 3: Create the component**

Create `src/components/PullRequestModalContent.tsx`:

```tsx
import { lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { CompareSummary } from './CompareSummary'

const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

interface PullRequestPayload {
  action: string
  pull_request: {
    merged: boolean
    title: string
    number: number
    body?: string | null
    user: { login: string; avatar_url: string }
    base: { sha: string; ref: string }
    head: { sha: string; ref: string }
  }
}

interface Props {
  event: GitHubFeedEvent
}

export function PullRequestModalContent({ event }: Props) {
  const pr = (event.payload as PullRequestPayload).pull_request
  const body = pr.body ?? ''
  const [owner, repo] = event.repo.full_name.split('/')

  return (
    <>
      {body && (
        <Suspense fallback={<div className="activity-modal__body-fallback" />}>
          <ReadmeRenderer content={body} repoOwner={owner ?? ''} repoName={repo ?? ''} />
        </Suspense>
      )}
      <CompareSummary
        owner={owner ?? ''}
        repo={repo ?? ''}
        base={pr.base.sha}
        head={pr.head.sha}
      />
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/PullRequestModalContent.test.tsx
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/PullRequestModalContent.tsx src/components/PullRequestModalContent.test.tsx
git commit -m "feat(feed): add PullRequestModalContent for merged-PR modal body"
```

---

## Task 11: `ActivityModal` frame

**Files:**
- Create: `src/components/ActivityModal.tsx`
- Create: `src/components/ActivityModal.css`
- Create: `src/components/ActivityModal.test.tsx`

### Background

Modal frame. Provides hero banner, header strip, scrollable body slot, footer slot. Handles overlay, keyboard (Esc), and backdrop click. Receives the event and delegates body rendering to a content component.

The footer's "Open in Library" navigates to `/library/repo/{owner}/{name}` using `react-router-dom`'s `useNavigate()`. It must call `onClose()` **before** `navigate()` to avoid a flash of the modal during the route change. Disabled (with title attribute as tooltip) when the repo isn't saved per `useSavedRepos().isSaved(owner, name)`.

`useSavedRepos` is exported from `../contexts/SavedRepos`.

The "View on GitHub" button calls `window.api.openExternal(url)`. This IPC bridge is exposed at the top level of `window.api` (see `electron/preload.ts:6` and the type declaration at `src/env.d.ts:53`) — there is no `system` namespace. The handler routes through `shell:openExternal` which uses Electron's `shell.openExternal()` to open the user's default browser.

- [ ] **Step 1: Verify the `openExternal` IPC bridge surface**

```bash
grep -n "openExternal" electron/preload.ts src/env.d.ts
```

Expected: `electron/preload.ts:6` exposes `openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)` directly on `window.api`, and `src/env.d.ts:53` declares `openExternal: (url: string) => Promise<void>`. If either is absent, restore them from this plan before continuing — the modal needs both to work.

- [ ] **Step 2: Write the failing tests**

Create `src/components/ActivityModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ActivityModal } from './ActivityModal'
import type { GitHubFeedEvent } from '../hooks/useFeed'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

let isSavedMock = vi.fn().mockReturnValue(true)
vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: (...args: [string, string]) => isSavedMock(...args), saveRepo: vi.fn(), loading: false }),
}))

vi.mock('./DitherBackground', () => ({ default: () => <div data-testid="dither" /> }))
vi.mock('./ReleaseModalContent', () => ({ ReleaseModalContent: () => <div data-testid="release-content" /> }))
vi.mock('./PullRequestModalContent', () => ({ PullRequestModalContent: () => <div data-testid="pr-content" /> }))

const releaseEvent: GitHubFeedEvent = {
  id: '1',
  type: 'ReleaseEvent',
  actor: { login: 'gaearon', avatar_url: '' },
  repo: { full_name: 'facebook/react' },
  payload: { release: { tag_name: 'v19.0.0', name: 'Reactivity Refresh', body: '', prerelease: false } },
  created_at: new Date('2026-04-29T10:00:00Z').toISOString(),
}

const prEvent: GitHubFeedEvent = {
  id: '2',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: 'Fix scrolling perf',
      number: 1248,
      body: '',
      user: { login: 'sindresorhus', avatar_url: '' },
      base: { sha: 'a', ref: 'main' },
      head: { sha: 'b', ref: 'feat' },
    },
  },
  created_at: new Date().toISOString(),
}

beforeEach(() => {
  navigateMock.mockClear()
  isSavedMock = vi.fn().mockReturnValue(true)
})

function renderModal(event: GitHubFeedEvent, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <ActivityModal event={event} onClose={onClose} />
    </MemoryRouter>
  )
}

describe('ActivityModal', () => {
  it('renders the version label and major tag for a major release', () => {
    renderModal(releaseEvent)
    expect(screen.getByText('v19.0.0')).toBeInTheDocument()
    expect(screen.getByText('MAJOR UPDATE')).toBeInTheDocument()
  })

  it('renders the PR number and PR MERGED tag for a merged PR', () => {
    renderModal(prEvent)
    expect(screen.getByText('#1248')).toBeInTheDocument()
    expect(screen.getByText('PR MERGED')).toBeInTheDocument()
  })

  it('renders ReleaseModalContent for release events', () => {
    renderModal(releaseEvent)
    expect(screen.getByTestId('release-content')).toBeInTheDocument()
    expect(screen.queryByTestId('pr-content')).toBeNull()
  })

  it('renders PullRequestModalContent for PR events', () => {
    renderModal(prEvent)
    expect(screen.getByTestId('pr-content')).toBeInTheDocument()
    expect(screen.queryByTestId('release-content')).toBeNull()
  })

  it('calls onClose when × button is clicked', () => {
    const onClose = vi.fn()
    renderModal(releaseEvent, onClose)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal(releaseEvent, onClose)
    fireEvent.click(container.querySelector('.activity-modal-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when modal body is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal(releaseEvent, onClose)
    fireEvent.click(container.querySelector('.activity-modal')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Esc is pressed', () => {
    const onClose = vi.fn()
    renderModal(releaseEvent, onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Open in Library closes modal then navigates when repo is saved', () => {
    const onClose = vi.fn()
    isSavedMock = vi.fn().mockReturnValue(true)
    renderModal(releaseEvent, onClose)

    fireEvent.click(screen.getByText('Open in Library'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/library/repo/facebook/react')
    // Order check: onClose should be called before navigate
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0])
  })

  it('Open in Library is disabled when repo is not saved', () => {
    isSavedMock = vi.fn().mockReturnValue(false)
    renderModal(releaseEvent)
    const button = screen.getByText('Open in Library') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/save/i)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/components/ActivityModal.test.tsx
```

Expected: All tests fail with "Cannot find module './ActivityModal'".

- [ ] **Step 4: Create the CSS**

Create `src/components/ActivityModal.css`:

```css
.activity-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.activity-modal {
  width: 720px;
  max-width: 100%;
  max-height: calc(100vh - 48px);
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.activity-modal__banner {
  height: 200px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  background: var(--bg3);
}

.activity-modal__banner-version {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.96);
  font-weight: 700;
  font-size: 56px;
  letter-spacing: 0.04em;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

.activity-modal__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(6px);
}

.activity-modal__close:hover {
  background: rgba(0, 0, 0, 0.7);
}

.activity-modal__header {
  padding: 18px 24px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.activity-modal__tag-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--t3);
}

.activity-modal__tag--major { color: var(--accent-text); }
.activity-modal__tag--prerelease { color: #ffa657; }

.activity-modal__tag-row .dot { color: var(--t4); font-weight: 400; }
.activity-modal__tag-row .posted { color: var(--t4); font-weight: 500; letter-spacing: 0.04em; }

.activity-modal__title {
  font-size: 22px;
  font-weight: 700;
  color: var(--t1);
  line-height: 1.3;
  margin: 0;
}

.activity-modal__byline {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--t3);
  font-size: 13px;
}

.activity-modal__byline img {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.activity-modal__byline strong {
  color: var(--t2);
  font-weight: 500;
}

.activity-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.activity-modal__body-fallback {
  min-height: 60px;
}

.activity-modal__footer {
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.activity-modal__footer .spacer {
  flex: 1;
}

.activity-modal__btn {
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  background: none;
  color: var(--t2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.activity-modal__btn--primary {
  background: var(--accent);
  color: #fff;
}

.activity-modal__btn--primary:hover { background: var(--accent-light); }

.activity-modal__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg4);
}

.activity-modal__btn--secondary {
  border-color: var(--border2);
}

.activity-modal__btn--secondary:hover {
  background: var(--bg3);
  color: var(--t1);
}

.activity-modal__btn--ghost {
  color: var(--t3);
}

.activity-modal__btn--ghost:hover {
  color: var(--t1);
  background: var(--bg3);
}
```

- [ ] **Step 5: Create the component**

Create `src/components/ActivityModal.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DitherBackground from './DitherBackground'
import { useSavedRepos } from '../contexts/SavedRepos'
import { classifyRelease } from '../utils/classifyRelease'
import { ReleaseModalContent } from './ReleaseModalContent'
import { PullRequestModalContent } from './PullRequestModalContent'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityModal.css'

interface Props {
  event: GitHubFeedEvent
  onClose: () => void
}

interface DerivedHeader {
  tier: 'normal' | 'major' | 'prerelease' | 'pr'
  tag: string
  title: string
  versionLabel: string
  bylineActor: string
  bylineActorAvatar: string
  externalUrl: string
}

const POSTED_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'long', day: 'numeric',
})

const MAJOR_FALLBACK_GRADIENT: [string, string] = ['#2a1750', '#110a26']

function deriveHeader(event: GitHubFeedEvent): DerivedHeader {
  const [owner, name] = event.repo.full_name.split('/')

  if (event.type === 'ReleaseEvent') {
    const release = (event.payload as {
      release: { tag_name: string; name?: string | null; prerelease?: boolean | null }
    }).release
    const tier = classifyRelease({
      tagName: release.tag_name,
      prereleaseFlag: release.prerelease === true,
    })
    const tag = tier === 'major' ? 'MAJOR UPDATE'
      : tier === 'prerelease' ? 'PRE-RELEASE'
      : 'UPDATE'
    const titleSuffix = release.name && release.name.trim() !== release.tag_name
      ? ` — ${release.name.trim()}`
      : ''
    return {
      tier,
      tag,
      title: `${release.tag_name}${titleSuffix}`,
      versionLabel: release.tag_name,
      bylineActor: event.actor.login,
      bylineActorAvatar: event.actor.avatar_url,
      externalUrl: `https://github.com/${owner}/${name}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    }
  }

  // PullRequestEvent
  const pr = (event.payload as {
    pull_request: { number: number; title: string; user: { login: string; avatar_url: string } }
  }).pull_request
  return {
    tier: 'pr',
    tag: 'PR MERGED',
    title: pr.title,
    versionLabel: `#${pr.number}`,
    bylineActor: pr.user.login,
    bylineActorAvatar: pr.user.avatar_url,
    externalUrl: `https://github.com/${owner}/${name}/pull/${pr.number}`,
  }
}

function tagModifier(tier: DerivedHeader['tier']): string {
  if (tier === 'major') return 'activity-modal__tag--major'
  if (tier === 'prerelease') return 'activity-modal__tag--prerelease'
  return ''
}

function openExternal(url: string) {
  void window.api.openExternal(url)
}

export function ActivityModal({ event, onClose }: Props) {
  const navigate = useNavigate()
  const { isSaved } = useSavedRepos()
  const header = useMemo(() => deriveHeader(event), [event])
  const [owner, name] = event.repo.full_name.split('/')
  const saved = isSaved(owner, name)
  const verb = event.type === 'ReleaseEvent' ? 'released by' : 'merged by'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleOpenInLibrary = () => {
    onClose()
    navigate(`/library/repo/${owner}/${name}`)
  }

  return (
    <div className="activity-modal-overlay" onClick={onClose}>
      <div className="activity-modal" onClick={(e) => e.stopPropagation()}>
        <div className="activity-modal__banner">
          <DitherBackground
            avatarUrl={`https://github.com/${owner}.png?size=400`}
            fallbackGradient={header.tier === 'major' ? MAJOR_FALLBACK_GRADIENT : undefined}
          />
          <div className="activity-modal__banner-version">{header.versionLabel}</div>
          <button
            className="activity-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="activity-modal__header">
          <div className="activity-modal__tag-row">
            <span className={tagModifier(header.tier)}>{header.tag}</span>
            <span className="dot">·</span>
            <span className="posted">Posted {POSTED_FMT.format(new Date(event.created_at))}</span>
          </div>
          <h1 className="activity-modal__title">{header.title}</h1>
          <div className="activity-modal__byline">
            <img src={`https://github.com/${owner}.png?size=40`} alt="" />
            <span><strong>{event.repo.full_name}</strong> · {verb} {header.bylineActor}</span>
          </div>
        </div>

        <div className="activity-modal__body">
          {event.type === 'ReleaseEvent'
            ? <ReleaseModalContent event={event} />
            : <PullRequestModalContent event={event} />}
        </div>

        <div className="activity-modal__footer">
          <button
            className="activity-modal__btn activity-modal__btn--primary"
            onClick={handleOpenInLibrary}
            disabled={!saved}
            title={saved ? '' : 'Save this repo to your library first'}
          >
            Open in Library
          </button>
          <button
            className="activity-modal__btn activity-modal__btn--secondary"
            onClick={() => openExternal(header.externalUrl)}
          >
            View on GitHub
          </button>
          <div className="spacer" />
          <button
            className="activity-modal__btn activity-modal__btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/components/ActivityModal.test.tsx
```

Expected: All 10 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/ActivityModal.tsx src/components/ActivityModal.css src/components/ActivityModal.test.tsx
git commit -m "feat(feed): add ActivityModal frame for click-through release/PR detail"
```

---

## Task 12: Wire `ActivityEvent` to use `BannerCard` for releases & PRs

**Files:**
- Modify: `src/components/ActivityEvent.tsx`
- Modify: `src/components/ActivityEvent.test.tsx`

### Background

Replace the `<ReleaseEventCard>` branch with a `<BannerCard>` populated from a release adapter. Add a new branch for `PullRequestEvent` that renders `<BannerCard>` populated from a PR adapter. Add an `onOpenModal` prop that the adapters wire into the card's `onClick`.

The `buildDescription` function and the bottom fall-through render path become dead code — delete them. Once releases and PRs are routed through `BannerCard`, no event types reach the bottom render.

The release adapter uses `classifyRelease` and `stripMarkdownPreview`. Title is `release.tag_name` plus an optional ` — name` suffix when the release has a distinct human-readable name.

The PR adapter uses `stripMarkdownPreview` on `pull_request.body`. Title is `pull_request.title`. Version label is `#${pull_request.number}`.

- [ ] **Step 1: Update the test file**

Replace the entire contents of `src/components/ActivityEvent.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ActivityEvent from './ActivityEvent'
import type { GitHubFeedEvent } from '../hooks/useFeed'

vi.mock('./ForkEventCard', () => ({
  ForkEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="fork-event-card">{event.repo.full_name}</div>
  ),
}))

vi.mock('./StarEventCard', () => ({
  StarEventCard: ({ event }: { event: GitHubFeedEvent }) => (
    <div data-testid="star-event-card">{event.repo.full_name}</div>
  ),
}))

vi.mock('./BannerCard', () => ({
  BannerCard: (props: Record<string, unknown>) => (
    <div
      data-testid="banner-card"
      data-tag={props.tag as string}
      data-tier={props.tier as string}
      data-title={props.title as string}
      data-version={props.versionLabel as string}
      data-repo={props.repoFullName as string}
      onClick={() => (props.onClick as () => void)?.()}
    />
  ),
}))

vi.mock('../contexts/SavedRepos', () => ({
  useSavedRepos: () => ({ isSaved: () => false, saveRepo: vi.fn(), loading: false }),
}))

const makeForkEvent = (): GitHubFeedEvent => ({
  id: '1',
  type: 'ForkEvent',
  actor: { login: 'zzzzshawn', avatar_url: '' },
  repo: { full_name: 'anthropics/Databuddy' },
  payload: { forkee: { full_name: 'zzzzshawn/Databuddy' } },
  created_at: new Date().toISOString(),
})

const makeWatchEvent = (): GitHubFeedEvent => ({
  id: '2',
  type: 'WatchEvent',
  actor: { login: 'alice', avatar_url: '' },
  repo: { full_name: 'some/repo' },
  payload: {},
  created_at: new Date().toISOString(),
})

const makeReleaseEvent = (overrides: Partial<{ tag_name: string; name: string | null; body: string; prerelease: boolean }> = {}): GitHubFeedEvent => ({
  id: '3',
  type: 'ReleaseEvent',
  actor: { login: 'maintainer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    release: {
      tag_name: overrides.tag_name ?? 'v1.0.0',
      name: overrides.name ?? null,
      body: overrides.body ?? 'Notes',
      prerelease: overrides.prerelease ?? false,
    },
  },
  created_at: new Date().toISOString(),
})

const makePrEvent = (overrides: Partial<{ number: number; title: string; body: string }> = {}): GitHubFeedEvent => ({
  id: '4',
  type: 'PullRequestEvent',
  actor: { login: 'reviewer', avatar_url: '' },
  repo: { full_name: 'acme/widget' },
  payload: {
    action: 'closed',
    pull_request: {
      merged: true,
      title: overrides.title ?? 'Improve scrolling',
      number: overrides.number ?? 1248,
      body: overrides.body ?? 'PR body',
      user: { login: 'contributor', avatar_url: '' },
      base: { sha: 'a', ref: 'main' },
      head: { sha: 'b', ref: 'feat' },
    },
  },
  created_at: new Date().toISOString(),
})

describe('ActivityEvent routing', () => {
  it('renders ForkEventCard for ForkEvent', () => {
    render(<MemoryRouter><ActivityEvent event={makeForkEvent()} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('fork-event-card')).toBeInTheDocument()
  })

  it('renders StarEventCard for WatchEvent', () => {
    render(<MemoryRouter><ActivityEvent event={makeWatchEvent()} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('star-event-card')).toBeInTheDocument()
  })

  it('renders BannerCard for ReleaseEvent with major tier when tag is x.0.0', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v2.0.0' })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('MAJOR UPDATE')
    expect(card.getAttribute('data-tier')).toBe('major')
    expect(card.getAttribute('data-version')).toBe('v2.0.0')
  })

  it('renders BannerCard for ReleaseEvent with normal tier when tag is x.y.z', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.2.3' })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('UPDATE')
    expect(card.getAttribute('data-tier')).toBe('normal')
  })

  it('renders BannerCard for ReleaseEvent with prerelease tier when prerelease flag is set', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ prerelease: true })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('PRE-RELEASE')
    expect(card.getAttribute('data-tier')).toBe('prerelease')
  })

  it('renders BannerCard for PullRequestEvent with #number version label', () => {
    render(<MemoryRouter><ActivityEvent event={makePrEvent({ number: 4242 })} onOpenModal={() => {}} /></MemoryRouter>)
    const card = screen.getByTestId('banner-card')
    expect(card.getAttribute('data-tag')).toBe('PR MERGED')
    expect(card.getAttribute('data-tier')).toBe('normal')
    expect(card.getAttribute('data-version')).toBe('#4242')
  })

  it('uses release.name as title suffix when distinct from tag', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.0.0', name: 'Big Bang' })} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('banner-card').getAttribute('data-title')).toBe('v1.0.0 — Big Bang')
  })

  it('uses just the tag as title when release name is null or matches tag', () => {
    render(<MemoryRouter><ActivityEvent event={makeReleaseEvent({ tag_name: 'v1.0.0', name: null })} onOpenModal={() => {}} /></MemoryRouter>)
    expect(screen.getByTestId('banner-card').getAttribute('data-title')).toBe('v1.0.0')
  })

  it('calls onOpenModal with the event when the BannerCard is clicked', () => {
    const onOpenModal = vi.fn()
    const event = makeReleaseEvent()
    render(<MemoryRouter><ActivityEvent event={event} onOpenModal={onOpenModal} /></MemoryRouter>)
    screen.getByTestId('banner-card').click()
    expect(onOpenModal).toHaveBeenCalledWith(event)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/ActivityEvent.test.tsx
```

Expected: Multiple tests fail — `ActivityEvent` doesn't accept `onOpenModal`, doesn't render `BannerCard`, and the release/PR adapters don't exist yet.

- [ ] **Step 3: Replace `ActivityEvent.tsx`**

Replace the entire contents of `src/components/ActivityEvent.tsx` with:

```tsx
import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityEvent.css'
import { ForkEventCard } from './ForkEventCard'
import { StarEventCard } from './StarEventCard'
import { BannerCard, type BannerCardTier } from './BannerCard'
import { classifyRelease, type ReleaseTier } from '../utils/classifyRelease'
import { stripMarkdownPreview } from '../utils/stripMarkdownPreview'

interface Props {
  event: GitHubFeedEvent
  onOpenModal: (event: GitHubFeedEvent) => void
}

const PREVIEW_MAX_LENGTH = 240

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
    prerelease?: boolean | null
  }
}

interface PullRequestPayload {
  pull_request: {
    title: string
    number: number
    body?: string | null
  }
}

function tierToTagText(tier: ReleaseTier): string {
  if (tier === 'major') return 'MAJOR UPDATE'
  if (tier === 'prerelease') return 'PRE-RELEASE'
  return 'UPDATE'
}

function releaseToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
) {
  const release = (event.payload as ReleasePayload).release
  const tier: ReleaseTier = classifyRelease({
    tagName: release.tag_name,
    prereleaseFlag: release.prerelease === true,
  })
  const trimmedName = release.name?.trim()
  const titleSuffix = trimmedName && trimmedName !== release.tag_name
    ? ` — ${trimmedName}`
    : ''
  const [ownerLogin] = event.repo.full_name.split('/')

  return {
    tag: tierToTagText(tier),
    tier: tier as BannerCardTier,
    title: `${release.tag_name}${titleSuffix}`,
    descriptionPreview: stripMarkdownPreview(release.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: release.tag_name,
    ownerLogin: ownerLogin ?? '',
    repoFullName: event.repo.full_name,
    occurredAt: event.created_at,
    onClick: () => onOpenModal(event),
  }
}

function pullRequestToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
) {
  const pr = (event.payload as PullRequestPayload).pull_request
  const [ownerLogin] = event.repo.full_name.split('/')
  return {
    tag: 'PR MERGED',
    tier: 'normal' as BannerCardTier,
    title: pr.title,
    descriptionPreview: stripMarkdownPreview(pr.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: `#${pr.number}`,
    ownerLogin: ownerLogin ?? '',
    repoFullName: event.repo.full_name,
    occurredAt: event.created_at,
    onClick: () => onOpenModal(event),
  }
}

export default function ActivityEvent({ event, onOpenModal }: Props) {
  if (event.type === 'ForkEvent') {
    return <ForkEventCard event={event} />
  }
  if (event.type === 'WatchEvent') {
    return <StarEventCard event={event} />
  }
  if (event.type === 'ReleaseEvent') {
    return <BannerCard {...releaseToBannerProps(event, onOpenModal)} />
  }
  if (event.type === 'PullRequestEvent') {
    return <BannerCard {...pullRequestToBannerProps(event, onOpenModal)} />
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/ActivityEvent.test.tsx
```

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ActivityEvent.tsx src/components/ActivityEvent.test.tsx
git commit -m "feat(feed): route releases & merged PRs through BannerCard via adapters"
```

---

## Task 13: Wire `ActivityFeed` for date grouping and modal state

**Files:**
- Modify: `src/components/ActivityFeed.tsx`
- Add: `src/components/ActivityFeed.test.tsx` (if it doesn't exist; otherwise extend it)

### Background

`ActivityFeed` becomes the host for:
1. Date grouping via `groupEventsByDay`
2. Modal state via `useState<GitHubFeedEvent | null>(null)`
3. Renders `<DateDivider>` followed by the group's events
4. Renders `<ActivityModal>` when `selectedEvent !== null`

Each `<ActivityEvent>` receives `onOpenModal={setSelectedEvent}`.

- [ ] **Step 1: Read the current state of `ActivityFeed.tsx`**

```bash
cat src/components/ActivityFeed.tsx
```

Confirm structure: header, body with skeleton/error/empty states, then `events.map(event => <ActivityEvent ... />)`.

- [ ] **Step 2: Write tests**

Create `src/components/ActivityFeed.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ActivityFeed from './ActivityFeed'

// Mock useFeed so we control the event list directly
const events = [
  { id: 'today1', type: 'WatchEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/b' }, payload: {}, created_at: new Date().toISOString() },
  { id: 'today2', type: 'ForkEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/c' }, payload: { forkee: { full_name: 'a/d' } }, created_at: new Date().toISOString() },
  { id: 'yesterday1', type: 'WatchEvent', actor: { login: 'a', avatar_url: '' }, repo: { full_name: 'a/e' }, payload: {}, created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
]

vi.mock('../hooks/useFeed', () => ({
  useFeed: () => ({ events, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: { login: 'octocat' } }),
}))

vi.mock('./ActivityEvent', () => ({
  default: ({ event, onOpenModal }: any) => (
    <button data-testid={`event-${event.id}`} onClick={() => onOpenModal(event)}>
      {event.id}
    </button>
  ),
}))

vi.mock('./ActivityModal', () => ({
  ActivityModal: ({ event, onClose }: any) => (
    <div data-testid="activity-modal" data-event-id={event.id} onClick={onClose} />
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ActivityFeed', () => {
  it('renders Today and Yesterday dividers', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
  })

  it('renders all events, grouped by day', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.getByTestId('event-today1')).toBeInTheDocument()
    expect(screen.getByTestId('event-today2')).toBeInTheDocument()
    expect(screen.getByTestId('event-yesterday1')).toBeInTheDocument()
  })

  it('renders no modal initially', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    expect(screen.queryByTestId('activity-modal')).toBeNull()
  })

  it('opens modal with the clicked event', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('event-today2'))
    const modal = screen.getByTestId('activity-modal')
    expect(modal).toBeInTheDocument()
    expect(modal.getAttribute('data-event-id')).toBe('today2')
  })

  it('closes modal when its onClose fires', () => {
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('event-today1'))
    expect(screen.getByTestId('activity-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('activity-modal'))
    expect(screen.queryByTestId('activity-modal')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/components/ActivityFeed.test.tsx
```

Expected: Tests fail — current `ActivityFeed.tsx` doesn't render dividers or the modal.

- [ ] **Step 4: Replace `ActivityFeed.tsx`**

Replace the entire contents of `src/components/ActivityFeed.tsx` with:

```tsx
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useFeed, type GitHubFeedEvent } from '../hooks/useFeed'
import ActivityEvent from './ActivityEvent'
import { DateDivider } from './DateDivider'
import { ActivityModal } from './ActivityModal'
import { groupEventsByDay } from '../utils/groupEventsByDay'
import './ActivityFeed.css'

export default function ActivityFeed() {
  const { user } = useGitHubAuth()
  const { events, loading, error, refresh } = useFeed()
  const [selectedEvent, setSelectedEvent] = useState<GitHubFeedEvent | null>(null)

  if (!user) {
    return (
      <div className="activity-feed activity-feed--empty">
        <p className="activity-feed-msg">Connect your GitHub account to see your activity</p>
      </div>
    )
  }

  const groups = groupEventsByDay(events)

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <span className="activity-feed-title">Activity</span>
        <button className="activity-feed-refresh" onClick={refresh} title="Refresh" disabled={loading}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="activity-feed-body">
        {loading && events.length === 0 && (
          <div className="activity-feed-skeletons">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="activity-event-skeleton" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="activity-feed-msg activity-feed-msg--error">{error}</p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="activity-feed-msg">Nothing in your network yet</p>
        )}

        {groups.map(group => (
          <div key={group.label}>
            <DateDivider label={group.label} />
            {group.events.map(event => (
              <ActivityEvent
                key={event.id}
                event={event}
                onOpenModal={setSelectedEvent}
              />
            ))}
          </div>
        ))}
      </div>

      {selectedEvent && (
        <ActivityModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/components/ActivityFeed.test.tsx
```

Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActivityFeed.tsx src/components/ActivityFeed.test.tsx
git commit -m "feat(feed): wire date dividers and click-through modal into ActivityFeed"
```

---

## Task 14: Delete `ReleaseEventCard` and run full verification

**Files:**
- Delete: `src/components/ReleaseEventCard.tsx`
- Delete: `src/components/ReleaseEventCard.css`
- Delete: `src/components/ReleaseEventCard.test.tsx`

### Background

The component is no longer imported anywhere — `ActivityEvent.tsx` now uses `BannerCard`, and the test file for it was rewritten in Task 12 with no `ReleaseEventCard` mock. Confirm nothing imports the file before deleting.

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "ReleaseEventCard" src/ electron/
```

Expected: zero matches. If any matches remain in `src/components/ActivityEvent.tsx` or `src/components/ActivityEvent.test.tsx`, fix those before deleting (a leftover from incomplete Task 12 — re-run that task's edits).

- [ ] **Step 2: Delete the files**

```bash
rm src/components/ReleaseEventCard.tsx
rm src/components/ReleaseEventCard.css
rm src/components/ReleaseEventCard.test.tsx
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass. If any test fails because it referenced `ReleaseEventCard`, update it to use `BannerCard` instead.

- [ ] **Step 4: Run TypeScript build to confirm no dangling references**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/
git commit -m "refactor(feed): remove ReleaseEventCard, replaced by BannerCard adapter"
```

- [ ] **Step 6: Manual verification (optional, owner-driven)**

The agentic implementer should NOT launch a dev server or take screenshots — the user tests UI changes themselves. Stop at Step 5 and surface the work for human review.

---

## Final verification checklist

After Task 14, the executor should confirm:

- [ ] All component tests pass: `npx vitest run`
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] No imports of `ReleaseEventCard` anywhere: `grep -rn "ReleaseEventCard" src/ electron/`
- [ ] `git status` is clean
- [ ] `git log --oneline` shows ~14 logical commits in order, each with a clean conventional-commit subject

The user will perform the visual verification (browser, click-through modal flow, date dividers, MAJOR/UPDATE/PRE-RELEASE/PR MERGED tag rendering, modal close paths). Surface the branch state and let them drive.
