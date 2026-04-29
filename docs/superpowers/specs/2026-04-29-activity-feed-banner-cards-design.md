# Activity Feed — Banner Cards & Modal Redesign

**Date:** 2026-04-29
**Status:** Draft

---

## Overview

Redesign the activity feed's release and pull-request rows as Steam-inspired banner cards: a dithered banner image (left) with a version/PR-number overlay, and a body (right) with an uppercase tier tag (`MAJOR UPDATE`, `UPDATE`, `PRE-RELEASE`, `PR MERGED`), title, two-line description preview, and repo meta. Group all events under uppercase-style date dividers (`Today`, `Yesterday`, `April 25`). Click a banner card to open a full-content modal: hero banner, full markdown body, diff stats, action buttons.

Star and fork events are out of scope for this redesign — they keep their existing card layouts and mix into the feed chronologically alongside the new banner cards.

---

## User-facing behaviour

### Feed view

- Events are grouped by local-day calendar date. Each group is preceded by a `DateDivider` row showing the label and a horizontal rule extending to the right edge.
  - Today's events → label `Today`
  - Yesterday's events → label `Yesterday`
  - Same calendar year → label `April 25`
  - Earlier years → label `April 25, 2025` (rare — feed is capped at 90 days)
- `ReleaseEvent` rows render as a `BannerCard` with banner area on the left and content on the right. Card-wide click opens the activity modal.
- `PullRequestEvent` rows (filtered to merged-only) render the same way; the banner-area overlay shows `#{number}` instead of a version, the tag is `PR MERGED`, the title is the PR title, the description is a 2-line plain-text preview of the PR body.
- `ForkEvent` and `WatchEvent` rows render unchanged using the existing `ForkEventCard` / `StarEventCard` components.
- The current inline "Read more" expand on releases is removed. The feed view never renders the full markdown body or the inline `CompareSummary` — those move into the modal.

### Modal view

- Opens centered, with a 55% black overlay over the feed.
- **Hero banner** at the top, full-width, 200px tall — same dither-of-owner-avatar as the card, but enlarged. Centered version label (e.g. `v19.0.0`, `#1248`) overlaid in 56px bold. Close button (×) in the top-right corner over the banner.
- **Header strip** below the banner — uppercase tag row (e.g. `MAJOR UPDATE · Posted Wed, April 29`), then the title, then a small byline (`{repo full name} · released by {actor}` for releases; `{repo full name} · merged by {actor}` for PRs).
- **Body** (scrollable) — full markdown body rendered via the existing `ReadmeRenderer` component, then the existing `CompareSummary` widget showing diff stats. For releases the compare uses the previous tag → current tag (parsed from the body's "Full Changelog" line, falling back to no compare if unparseable). For PRs the compare uses `pull_request.base.sha` → `pull_request.head.sha`.
- **Footer** — `Open in Library` (violet primary, navigates to `/library/repo/{owner}/{name}` if saved, otherwise disabled with tooltip), `View on GitHub` (opens external URL), and a `Close` ghost button on the right.
- **Closes** on × button click, backdrop click, or Esc keypress.

### Tier classification

- Release with `prerelease: true` flag → `PRE-RELEASE` (amber tag)
- Release with semver tag where `major >= 1 && minor === 0 && patch === 0 && !prereleaseFlag` → `MAJOR UPDATE` (violet tag, violet card border, slightly warmer dither)
- All other releases → `UPDATE` (gray tag, default border)
- Merged PR → `PR MERGED` (gray tag, default border)
- Tags that don't parse as semver (e.g. `release-2024-04`) → `UPDATE`

### Visual design

- **Card width** — fills the activity-feed body container (matching today's `ActivityFeed.tsx` layout).
- **Card banner** — 220px wide, full card height. Renders `DitherBackground` (existing component, `src/components/DitherBackground.tsx`) with `avatarUrl` set to `https://github.com/{owner}.png`. Version/PR-number overlay sits centered over the dither, 24px bold with a soft text-shadow.
- **Major-update dither** — pass `fallbackGradient={['#2a1750', '#110a26']}` to `DitherBackground` so the warmer violet shows during avatar load and as a subtle backdrop tint. Major cards also receive a violet border (`var(--accent-border)`) and a violet inset shadow.
- **Tag color tokens** — `UPDATE`/`PR MERGED`: `var(--t3)`. `MAJOR UPDATE`: `var(--accent-text)` (`#a78bfa`). `PRE-RELEASE`: `#ffa657`.
- **Modal width** — 720px max, capped to viewport with 24px margin. Body scrolls internally; banner and footer stay pinned.

---

## Components

### `BannerCard.tsx` (new)

Dumb visual shell. Takes structured props and renders the card. Knows nothing about event types or GitHub payloads.

**Props:**
```ts
interface BannerCardProps {
  tag: string                     // e.g. "MAJOR UPDATE", "PR MERGED"
  tier: 'normal' | 'major' | 'prerelease'
  title: string
  descriptionPreview: string      // pre-stripped plain text, CSS-clamped to 2 lines
  versionLabel: string            // overlaid on banner: "v19.0.0", "#1248"
  ownerLogin: string              // used to build avatar URL for DitherBackground
  repoFullName: string            // shown in meta row
  occurredAt: string              // ISO timestamp for relativeTime()
  onClick: () => void
}
```

**Structure:**
```tsx
<div className={`banner-card banner-card--${tier}`} onClick={onClick}>
  <div className="banner-card__image">
    <DitherBackground
      avatarUrl={`https://github.com/${ownerLogin}.png?size=200`}
      fallbackGradient={tier === 'major' ? ['#2a1750', '#110a26'] : undefined}
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
```

`DitherBackground` is rendered with `staticFrame` to avoid the per-frame redraw — the dither for a feed card doesn't need animation.

### `BannerCard.css` (new)

- `.banner-card` — flex row, `var(--bg2)` background, `var(--border)` border, `var(--radius-lg)` radius, `cursor: pointer`. Hover: border becomes `var(--border2)`.
- `.banner-card--major` — border `var(--accent-border)` + inset `box-shadow: 0 0 0 1px var(--accent-border) inset`. Hover: border + shadow upgrade to `var(--accent)`.
- `.banner-card__image` — width 220px, position relative, overflow hidden. `DitherBackground` is positioned absolute via its own styles.
- `.banner-card__version-overlay` — absolute inset 0, flex centered, 24px bold, white-with-shadow text. `pointer-events: none`.
- `.banner-card__body` — flex column, padding 14px 16px 12px, `min-width: 0` (so the meta row truncates).
- `.banner-card__tag` — uppercase 10px, letter-spacing 0.12em, `var(--t3)`. Variants `--major` → `var(--accent-text)`, `--prerelease` → `#ffa657`.
- `.banner-card__title` — 15px, weight 600, `var(--t1)`.
- `.banner-card__desc` — 13px, `var(--t3)`, `-webkit-line-clamp: 2`, `display: -webkit-box`, `overflow: hidden`.
- `.banner-card__meta` — auto-margin top, flex row, 11px, `var(--t4)`, with 14px-circle owner avatar.

### `ActivityModal.tsx` (new)

Modal frame. Provides hero banner, header strip, scrollable body slot, footer slot. Handles overlay, keyboard (Esc), and backdrop click. Receives the event and delegates body rendering to a content component.

**Props:**
```ts
interface ActivityModalProps {
  event: GitHubFeedEvent
  onClose: () => void
}
```

**Behaviour:**
- Internally branches on `event.type` to derive `tier`, `tag`, `title`, `versionLabel`, `byline`, and to choose between `<ReleaseModalContent>` and `<PullRequestModalContent>` for the body.
- Renders the hero banner using the same `DitherBackground` + overlay pattern as `BannerCard`, but in a 200px-tall hero variant.
- Renders the close button, header strip, body (with the chosen content component), and footer.
- Footer buttons:
  - `Open in Library` — calls `useNavigate()(\`/library/repo/${owner}/${name}\`)` *and* `onClose()`. Disabled with tooltip "Save this repo to your library first" if `useSavedRepos().isSaved(owner, name) === false`.
  - `View on GitHub` — opens the appropriate URL externally (`https://github.com/{owner}/{name}/releases/tag/{tag}` for releases, `https://github.com/{owner}/{name}/pull/{number}` for PRs).
  - `Close` — calls `onClose()`.
- Esc keypress handler attached on mount, removed on unmount.

### `ActivityModal.css` (new)

- `.activity-modal-overlay` — position fixed inset 0, z-index 1000, `rgba(0,0,0,0.55)`, flex centered, padding 24px.
- `.activity-modal` — width 720px, max-width 100%, max-height calc(100vh - 48px), `var(--bg2)`, `var(--border2)` border, `var(--radius-lg)` radius, flex column, overflow hidden, `box-shadow: 0 24px 80px rgba(0,0,0,0.45)`.
- `.activity-modal__banner` — height 200px, flex-shrink 0, position relative.
- `.activity-modal__banner-version` — absolute inset 0, flex centered, 56px bold, `text-shadow: 0 4px 24px rgba(0,0,0,0.7)`, `pointer-events: none`.
- `.activity-modal__close` — absolute top 12px right 12px, 32px circular button with semi-transparent black background, `backdrop-filter: blur(6px)`.
- `.activity-modal__header` — padding 18px 24px 16px, border-bottom `var(--border)`, flex column gap 6px.
- `.activity-modal__tag-row` — 11px uppercase letter-spacing 0.12em `var(--t3)` flex row, with `--major` variant.
- `.activity-modal__title` — 22px weight 700.
- `.activity-modal__byline` — 13px `var(--t3)`, with 18px owner avatar.
- `.activity-modal__body` — flex 1, overflow-y auto, padding 20px 24px, flex column gap 22px.
- `.activity-modal__footer` — padding 14px 24px, border-top `var(--border)`, flex row gap 10px. The `Close` ghost button uses `margin-left: auto`.
- Button styles reuse the existing `.update-btn-apply` / `.update-btn-cancel` patterns from `UpdateModal.css` where shapes are similar; new `.activity-modal-btn--ghost` for the Close button (transparent, hover background `var(--bg3)`).

### `ReleaseModalContent.tsx` (new)

**Props:** `{ event: GitHubFeedEvent }`

Renders the body content for a `ReleaseEvent` modal:
- Lazy-loaded `<ReadmeRenderer>` (existing component) with the release body markdown, after `stripCompareLine()`-ing the auto-generated changelog line.
- `<CompareSummary>` (existing component) below the markdown, when `parseCompareUrl(body)` returns a valid `{ owner, repo, base, head }`. Skipped silently if no compare URL is in the body.

### `PullRequestModalContent.tsx` (new)

**Props:** `{ event: GitHubFeedEvent }`

Renders the body content for a `PullRequestEvent` modal:
- Extracts `pull_request.body` from the event payload. Renders via the existing `<ReadmeRenderer>` (lazy).
- Renders `<CompareSummary>` with `owner`, `repo` from `event.repo.full_name`, `base = pull_request.base.sha`, `head = pull_request.head.sha`. The existing `CompareSummary` already calls `window.api.github.getCompare(owner, name, base, head)`, which is reused as-is.

### `DateDivider.tsx` (new)

**Props:** `{ label: string }`

Tiny presentational component:
```tsx
<div className="date-divider">
  <span className="date-divider__label">{label}</span>
  <span className="date-divider__line" />
</div>
```

### `DateDivider.css` (new)

- `.date-divider` — flex row, align-items center, gap 12px, padding 18px 0 12px (16px horizontal handled by feed container).
- `.date-divider__label` — 11px weight 600, letter-spacing 0.1em, `var(--t3)`. **Not** `text-transform: uppercase` — the label string is provided pre-formatted ("Today", "April 25"), keeping casing decisions in one place (the util).
- `.date-divider__line` — flex 1, height 1px, background `var(--border)`.

### `ActivityEvent.tsx` (modify)

Replace the existing `if (event.type === 'ReleaseEvent')` branch's render of `<ReleaseEventCard>` with a render of `<BannerCard>` populated from a release adapter. Add a new branch for `PullRequestEvent` that renders `<BannerCard>` populated from a PR adapter.

```tsx
if (event.type === 'ReleaseEvent') {
  return <BannerCard {...releaseToBannerProps(event, onOpenModal)} />
}
if (event.type === 'PullRequestEvent') {
  // useFeed already filters PR events to merged only, so we don't need to recheck here
  return <BannerCard {...pullRequestToBannerProps(event, onOpenModal)} />
}
```

`onOpenModal` is a new optional prop on `ActivityEvent` — `(event: GitHubFeedEvent) => void` — wired up by `ActivityFeed`. The `onClick` prop on `BannerCard` calls `onOpenModal(event)`.

The fork and watch branches are unchanged. The PR text-rendering path that currently flows through `buildDescription` becomes dead code (PRs now route through `BannerCard` above the fall-through). The function can be deleted; the bottom-of-component fallback render path is removed.

### `ActivityFeed.tsx` (modify)

Three changes:

1. **Group events by day** — call `groupEventsByDay(events)` to produce `{ label, events }[]`. Render each group as a `<DateDivider>` followed by the group's events.
2. **Track modal state** — `const [selectedEvent, setSelectedEvent] = useState<GitHubFeedEvent | null>(null)`. Pass `onOpenModal={setSelectedEvent}` to each `<ActivityEvent>`.
3. **Render the modal** — when `selectedEvent !== null`, render `<ActivityModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />`.

### `ReleaseEventCard.tsx` and `ReleaseEventCard.css` (delete)

Replaced by `BannerCard` plus the release adapter inside `ActivityEvent.tsx`. Tests file for it (`src/components/ReleaseEventCard.test.tsx`, if it exists) is deleted with it.

---

## Utils

### `groupEventsByDay.ts` (new)

```ts
export interface EventGroup {
  label: string                 // "Today", "Yesterday", "April 25", "April 25, 2025"
  events: GitHubFeedEvent[]
}

export function groupEventsByDay(events: GitHubFeedEvent[], now = new Date()): EventGroup[]
```

- Bucket events by **local-time** date (use `new Date(event.created_at).toDateString()` as the key).
- Iterate input order to preserve the existing chronological-descending sort from `useFeed`.
- Compute label per bucket:
  - Same day as `now` → `"Today"`
  - Day before `now` → `"Yesterday"`
  - Same calendar year as `now` → `formatLocalDate(date, 'MMMM d')` → e.g. `"April 25"`
  - Otherwise → `formatLocalDate(date, 'MMMM d, yyyy')` → e.g. `"April 25, 2025"`

Use `Intl.DateTimeFormat` with explicit options rather than a date library — already the pattern in the codebase.

### `parseSemverTag.ts` (new)

```ts
export interface SemverParts {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}
export function parseSemverTag(tag: string): SemverParts | null
```

- Strips a leading `v` if present.
- Matches `^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$` (case-insensitive).
- Returns `null` if no match (caller treats as `UPDATE`).

### `classifyRelease.ts` (new)

```ts
export type ReleaseTier = 'major' | 'normal' | 'prerelease'

export function classifyRelease(opts: {
  tagName: string
  prereleaseFlag: boolean
}): ReleaseTier
```

- `prereleaseFlag === true` → `'prerelease'`
- `parseSemverTag(tagName)` returns `{major, minor, patch}` with `major >= 1 && minor === 0 && patch === 0 && !parts.prerelease` → `'major'`
- Otherwise → `'normal'`

The release flag from the GitHub API isn't currently surfaced through `useFeed`'s synthesized `ReleaseEvent` shape — see [Data flow](#data-flow) below for the small extension needed.

### `stripMarkdownPreview.ts` (new)

```ts
export function stripMarkdownPreview(body: string, maxLength: number): string
```

- Removes the auto-generated `**Full Changelog**: ...` line via existing `stripCompareLine` helper.
- Strips fenced code blocks (` ``` ... ``` `) and inline code (`` ` `` to `` ` ``).
- Strips images (`![alt](url)` → empty).
- Strips link wrappers (`[text](url)` → `text`).
- Strips heading markers (`^#{1,6}\s+` → empty).
- Strips emphasis (`*`, `_`, `**`, `__`) leaving inner text.
- Collapses runs of whitespace and newlines to single spaces.
- Trims to `maxLength`, breaking at the last word boundary if mid-word.

Used by both release and PR adapters to feed the 2-line preview into `BannerCard`. CSS line-clamp handles the visual truncation; `maxLength` is a safety cap to avoid stuffing kilobytes of stripped markdown into the DOM (`240` is enough for a 2-line preview at this font size).

### `releaseToBannerProps.ts` and `pullRequestToBannerProps.ts`

These are small adapters living **inside `ActivityEvent.tsx`** as local functions, not separate modules. Each takes the event and the modal-open callback and returns `BannerCardProps`. They handle the type-narrowing of `event.payload` and wire up `classifyRelease` / `stripMarkdownPreview` / version-label formatting.

For releases: `versionLabel = release.tag_name`, `tag` from `classifyRelease(...)`, `title` from `release.name || release.tag_name`.
For PRs: `versionLabel = '#' + pull_request.number`, `tag = 'PR MERGED'`, `title = pull_request.title`.

---

## Data flow

### Release event surfacing the prerelease flag

`useFeed.ts` currently synthesizes `ReleaseEvent`s from the repo-API path (`getReleases`) without including the `prerelease` boolean. To classify pre-releases correctly, two small extensions are needed:

1. `electron/github.ts:GitHubRelease` already includes `prerelease`. Confirmed by inspection — no change needed in the main process.
2. `useFeed.ts` synthesized release-event payload — extend the mapped object to carry `prerelease`:
   ```ts
   payload: { release: { tag_name, name, body, prerelease } }
   ```
3. The `ReceivedEvents` path delivers `ReleaseEvent`s with full `release` payload from GitHub directly — `prerelease` is already present in the API response. The `ReceivedEvent` union type at `electron/github.ts:89` should be extended to include `prerelease: boolean` on the release variant.

### PR event filtering

`PullRequestEvent` from GitHub's received_events arrives with multiple `action` values. `useFeed.ts` will filter to merged events only, before pushing into `events`:
```ts
.filter(e =>
  e.type !== 'PullRequestEvent' ||
  (e.payload as { action?: string; pull_request?: { merged?: boolean } }).action === 'closed' &&
    (e.payload as { pull_request?: { merged?: boolean } }).pull_request?.merged === true
)
```
This keeps `PullRequestEvent` consumers in `ActivityEvent.tsx` simple (no need to recheck the action).

### Modal lifecycle

```
User clicks BannerCard
  → BannerCard.onClick(event)
    → ActivityEvent.onOpenModal(event)
      → ActivityFeed.setSelectedEvent(event)
        → ActivityFeed renders <ActivityModal event={selectedEvent} onClose={...} />
          → ActivityModal renders <ReleaseModalContent> or <PullRequestModalContent>
            → ReleaseModalContent renders <ReadmeRenderer> + (conditional) <CompareSummary>
              → CompareSummary fetches diff via window.api.github.getCompare()
                                                    (already cached in main process)
User dismisses modal (× / backdrop / Esc)
  → ActivityModal.onClose()
    → ActivityFeed.setSelectedEvent(null)
```

---

## Tests

### New tests

| File | Scenarios |
|---|---|
| `src/utils/groupEventsByDay.test.ts` | Today/Yesterday/this-year/older-year labels; multiple events same day; mixed days; empty input |
| `src/utils/parseSemverTag.test.ts` | `v1.2.3`, `1.2.3`, `v1.2.3-rc.1`, `release-2024`, `1.0.0`, `0.5.0`, malformed |
| `src/utils/classifyRelease.test.ts` | prerelease flag wins, major detection, 0.x non-major, missing semver returns normal |
| `src/utils/stripMarkdownPreview.test.ts` | strips headings/links/images/code, collapses whitespace, max-length truncation, empty body |
| `src/components/BannerCard.test.tsx` | Renders with each tier; click handler fires; respects descriptionPreview clamp; meta row content |
| `src/components/ActivityModal.test.tsx` | Esc closes; backdrop click closes; × closes; renders correct content per event type; footer buttons disabled appropriately |
| `src/components/DateDivider.test.tsx` | Renders label and line |

### Modified tests

| File | Change |
|---|---|
| `src/components/ActivityEvent.test.tsx` | Update assertions: ReleaseEvent now renders BannerCard; new PR branch tested; existing fork/star branches unchanged |

### Deleted tests

- `src/components/ReleaseEventCard.test.tsx` (if present) — component deleted

---

## File summary

| File | Change |
|---|---|
| `src/components/BannerCard.tsx` | New |
| `src/components/BannerCard.css` | New |
| `src/components/BannerCard.test.tsx` | New |
| `src/components/ActivityModal.tsx` | New |
| `src/components/ActivityModal.css` | New |
| `src/components/ActivityModal.test.tsx` | New |
| `src/components/ReleaseModalContent.tsx` | New |
| `src/components/PullRequestModalContent.tsx` | New |
| `src/components/DateDivider.tsx` | New |
| `src/components/DateDivider.css` | New |
| `src/components/DateDivider.test.tsx` | New |
| `src/utils/groupEventsByDay.ts` | New |
| `src/utils/groupEventsByDay.test.ts` | New |
| `src/utils/parseSemverTag.ts` | New |
| `src/utils/parseSemverTag.test.ts` | New |
| `src/utils/classifyRelease.ts` | New |
| `src/utils/classifyRelease.test.ts` | New |
| `src/utils/stripMarkdownPreview.ts` | New |
| `src/utils/stripMarkdownPreview.test.ts` | New |
| `src/components/ActivityFeed.tsx` | Modify — group + modal state |
| `src/components/ActivityEvent.tsx` | Modify — release/PR adapters → BannerCard, accept onOpenModal prop |
| `src/components/ActivityEvent.test.tsx` | Modify — update assertions |
| `src/hooks/useFeed.ts` | Modify — carry `prerelease` flag; filter PR events to merged only |
| `src/components/ReleaseEventCard.tsx` | Delete |
| `src/components/ReleaseEventCard.css` | Delete |
| `src/components/ReleaseEventCard.test.tsx` | Delete (if exists) |

Estimated scope: ~1,100 lines net added across ~20 files (heavy on tests; visual code is well-bounded).

---

## Out of scope

- Star and fork event card redesigns (`StarEventCard`, `ForkEventCard`) — unchanged.
- Real-time updates, websockets, or any push-based feed — polling stays as-is.
- Image extraction from release/PR bodies (rejected during brainstorm — dither-only is the approach).
- Per-repo banner art uploads, custom user images, or banner caching beyond what `DitherBackground` already does internally.
- Modal navigation (prev/next) — single-event-at-a-time.
- Social actions (rate, comment, share) — not relevant to our app.

---

## Open questions

None blocking. Design is internally consistent. Two minor things the implementer can decide inline:

1. Whether `BannerCard.tsx` accepts the full `event` and does its own destructuring, or stays a pure visual component as specified above with adapters in `ActivityEvent.tsx`. The spec prefers the latter for testability — `BannerCard` is rendered with literal props in tests, no event mocks needed.
2. `staticFrame` on `DitherBackground` for the feed-card variant vs. animated for the hero modal banner. The spec specifies static for the card, animated for the hero. Implementer can confirm performance is acceptable for animated; if not, both should be static.
