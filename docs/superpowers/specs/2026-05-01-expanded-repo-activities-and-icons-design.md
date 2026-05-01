# Expanded Repo: Activities Tab, Solid Icons, README Mentions Removal

**Date:** 2026-05-01
**Status:** Approved (user)
**Scope:** Three independent changes to the expanded repo view (`src/views/RepoDetail.tsx`) and a few neighbours.

## Overview

Three changes ship together but are independent and could land as separate commits:

1. **Activities tab** replaces the existing Releases tab. Same release data (`getReleases`), restyled as `BannerCard` feed items matching the Library's activity feed. Becomes the new default tab when releases exist; falls back to README when empty.
2. **Solid icons** for the Learn / Star / Fork / Clone buttons in the article action row. Lucide outline icons → Phosphor Fill via `react-icons/pi` (already a codebase convention).
3. **Remove README mentions extraction** — the `rehypeExtractMentions` plugin that pulls Contributor / Sponsor / Backer / Acknowledgments / Built-with / Powered-by sections into a separate "Mentions" section is deleted entirely. Those sections render inline at the position the README author wrote them. Supersedes [2026-04-15-mentions-section-design.md](./2026-04-15-mentions-section-design.md).

No new files. Six existing files modified.

## File Touch List

| File | Change |
|---|---|
| `src/views/RepoDetail.tsx` | Tab type + ALL_TABS, default-tab effect, Activities tab body, modal wiring, 4 icon swaps |
| `src/components/ActivityEvent.tsx` | Export `releaseToBannerProps` (currently non-exported) |
| `src/components/ReleaseModalContent.tsx` | New optional props: install button + assets list |
| `src/components/ActivityModal.tsx` | Thread install props through to `ActivityModalEntry` → `ReleaseModalContent` |
| `src/components/ReadmeRenderer.tsx` | Delete `rehypeExtractMentions` plugin and its registration |
| `src/components/ReadmeRenderer.test.tsx` | Delete 3 mention-related tests |
| `src/styles/globals.css` | Delete `.rm-mentions*` selectors |
| `src/views/RepoDetail.test.tsx` | New tests for default-tab logic, tab visibility, modal opening |
| `src/components/ReleaseModalContent.test.tsx` | New tests for install button + assets render |
| `src/components/ActivityModal.test.tsx` | New test for prop forwarding |

## 1. Activities Tab

### 1.1 Tab type and ALL_TABS

`RepoDetail.tsx:416-428`. Replace `'releases'` with `'activities'`. Place `'activities'` first in `ALL_TABS` (before `'readme'`) so it appears leftmost in the tab strip.

```ts
type Tab = 'activities' | 'readme' | 'files' | 'skill' | 'collections' | 'related' | 'videos' | 'posts' | 'commands' | 'components'
const ALL_TABS: { id: Tab; label: string }[] = [
  { id: 'activities',  label: 'Activities' },
  { id: 'readme',      label: 'README' },
  { id: 'files',       label: 'Files' },
  { id: 'skill',       label: 'Skills Folder' },
  { id: 'collections', label: 'Collections' },
  { id: 'related',     label: 'Related' },
  { id: 'videos',      label: 'Videos' },
  { id: 'posts',       label: 'Posts' },
  { id: 'commands',    label: 'Commands' },
  { id: 'components',  label: 'Components' },
]
```

### 1.2 Default tab logic

Initial `activeTab` becomes `'activities'` (was `'readme'` at line 470). A new effect falls back to `'readme'` once the `releases` fetch resolves to empty / error, but only on the first resolve and only if the user hasn't already navigated to a different tab.

```ts
const [activeTab, setActiveTab] = useState<Tab>('activities')
const fellBackRef = useRef(false)
useEffect(() => {
  if (fellBackRef.current) return
  if (releases === 'loading') return
  fellBackRef.current = true
  const hasActivity = Array.isArray(releases) && (releases as ReleaseRow[]).length > 0
  if (!hasActivity && activeTab === 'activities') setActiveTab('readme')
}, [releases, activeTab])
```

While `releases === 'loading'`, the Activities tab body shows a loading skeleton (the same one the existing Releases tab uses today). No flicker for repos with releases.

### 1.3 Tab visibility

The existing visibility filter at `RepoDetail.tsx:967-974` gains a rule for `'activities'`:

```ts
if (t.id === 'activities') {
  if (releases === 'loading') return true        // keep visible during initial load
  return Array.isArray(releases) && releases.length > 0
}
```

### 1.4 Synthetic event adapter

Inline helper in `RepoDetail.tsx`. Maps a `ReleaseRow` to the `GitHubFeedEvent` shape that `BannerCard` and `ActivityModal` consume.

```ts
function releaseRowToFeedEvent(r: ReleaseRow, repoFullName: string): GitHubFeedEvent {
  return {
    id: `release-${r.tag_name}`,
    type: 'ReleaseEvent',
    actor: { login: '', avatar_url: '' },     // see note below
    repo: { full_name: repoFullName },
    payload: {
      release: {
        tag_name: r.tag_name,
        name: r.name,
        body: r.body,
        prerelease: r.prerelease,
        // Carry assets through so ReleaseModalContent can render the assets list
        assets: r.assets,
      },
    },
    created_at: r.published_at,
  }
}
```

**Empty `actor` is safe:**
- `BannerCard` doesn't read `actor` — `releaseToBannerProps` derives the card avatar from `event.repo.full_name` via `repoOwnerAvatarUrl()`.
- `ActivityModalEntry.deriveHeader` (`ActivityModal.tsx:39-78`) computes a `bylineActor: event.actor.login` field, but the entry render block (`ActivityModal.tsx:179-234`) doesn't display `bylineActor` anywhere — it's dead data on the header. Empty string flows through harmlessly.
- `ReleaseRow` has no `author` field (verified in `src/types/repo.ts:58-65`), so we can't populate `actor` from the release row even if we wanted to.

### 1.5 Activities tab body

Replaces the entire `activeTab === 'releases'` block at `RepoDetail.tsx:1488-1579`.

The current `ActivityModal` is a stack reader (per commit `894ac1d`): it takes an array of events plus an `initialEventId` and renders the clicked event with all earlier supported events stacked below for vertical scrolling. We mirror that behaviour for the per-repo Activities tab — clicking release v3 opens a panel showing v3, v2, v1 stacked.

State:
```ts
const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null)
```

Memoised event list (rebuilt only when releases or owner/name changes):
```ts
const activityEvents = useMemo(
  () => Array.isArray(releases)
    ? releases.map(r => releaseRowToFeedEvent(r, `${owner}/${name}`))
    : [],
  [releases, owner, name],
)
```

Body render:
```tsx
{activeTab === 'activities' && (
  releases === 'loading' ? (
    <p className="repo-detail-placeholder">Loading activity…</p>
  ) : releases === 'error' ? (
    <p className="repo-detail-placeholder">Failed to load activity.</p>
  ) : (
    <div className="repo-activity-feed">
      {activityEvents.map(event => (
        <BannerCard
          key={event.id}
          {...releaseToBannerProps(event, () => setSelectedReleaseId(event.id))}
        />
      ))}
    </div>
  )
)}

{selectedReleaseId && (
  <ActivityModal
    events={activityEvents}
    initialEventId={selectedReleaseId}
    onClose={() => setSelectedReleaseId(null)}
    onLearnVersion={handleVersionLearn}
    versionLearnStates={versionLearnStates}
    versionedLearns={versionedLearns}
  />
)}
```

`releaseToBannerProps` is currently a non-exported function at `ActivityEvent.tsx:47-67` — **export it** (minimal touch surface; future extraction to a shared util is cheap if needed).

### 1.6 Inline expand removed

The current Releases tab supports inline body expansion (`expandedReleases` Set state, `Show more` button) and inline assets listing. Both are deleted. The full body and assets list now appear in the modal.

State to remove from `RepoDetail.tsx`: `expandedReleases`, `setExpandedReleases`. Keep `versionedLearns`, `versionLearnStates`, `relearningTarget`, `handleVersionLearn` — they're still used by the modal install button.

### 1.7 New CSS (minimal)

`.repo-activity-feed` — vertical flex container with gap matching the Library's activity feed spacing. New rule in `globals.css` (or co-located if there's a `RepoDetail.css`; check during implementation). Roughly:

```css
.repo-activity-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

(Final value should match the Library's `ActivityFeed` gap — verify during implementation.)

## 2. ReleaseModalContent: Install Button and Assets

`src/components/ReleaseModalContent.tsx`. New optional props.

### 2.1 Props

```ts
type VersionLearnState = 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'

interface Props {
  event: GitHubFeedEvent
  // New optional props:
  onLearnVersion?: (tag: string) => void
  learnState?: VersionLearnState
  alreadyLearned?: boolean        // true if this tag is in versionedLearns Set
}
```

### 2.2 Install button render

Below the body, before `<CompareSummary>`, render the button **only when `onLearnVersion` is provided**. This preserves Library-feed behaviour (no install button there) without a feature flag.

Visual states match the existing Releases-tab install button (`RepoDetail.tsx:1514-1527`):

| Effective state | Render |
|---|---|
| `alreadyLearned === true` | `<span className="repo-release-installed-label">{repoName}@{safeTag}.skill.md</span>` |
| `learnState === 'LEARNING'` | `<span className="repo-release-installing-label">Learning…</span>` |
| `learnState === 'ERROR'` | `<button class="repo-release-install-btn repo-release-install-btn--error" onClick={() => onLearnVersion(tag)}>Failed — retry</button>` |
| default (`UNLEARNED`) | `<button class="repo-release-install-btn" onClick={() => onLearnVersion(tag)}>Learn this version</button>` |

`safeTag` uses the existing `sanitiseRef` helper — import or duplicate as needed. `repoName` comes from `event.repo.full_name.split('/')[1]`.

### 2.3 Assets list

Read `event.payload.release.assets` (typed via an updated `ReleasePayload` interface in this file). Render only when `onLearnVersion` is provided AND `assets?.length > 0`. Layout mirrors the existing `repo-release-assets` block at `RepoDetail.tsx:1543-1559` (icon, name, size, optional download count). Reuse the same CSS classes — they already exist.

Library-feed release modals don't get the assets list because `onLearnVersion` is absent there, matching current behaviour.

## 3. ActivityModal: Prop Forwarding

`src/components/ActivityModal.tsx`. The current API (per commit `894ac1d`) is a panel-based vertical reader rendering a stack of events via internal `ActivityModalEntry` children. The new install props need to thread through both layers: `ActivityModal` → `ActivityModalEntry` → `ReleaseModalContent`.

### 3.1 `ActivityModal` props (current line 11-15)

```ts
interface Props {
  events: GitHubFeedEvent[]
  initialEventId: string
  onClose: () => void
  // New (all optional — Library feed call sites omit them):
  onLearnVersion?: (tag: string) => void
  versionLearnStates?: Map<string, VersionLearnState>
  versionedLearns?: Set<string>
}
```

### 3.2 `ActivityModalEntry` props (current `EntryProps`, lines 90-94)

```ts
interface EntryProps {
  event: GitHubFeedEvent
  onClose: () => void
  eager?: boolean
  // New:
  onLearnVersion?: (tag: string) => void
  learnState?: VersionLearnState
  alreadyLearned?: boolean
}
```

### 3.3 Per-entry derivation in the map (current lines 268-275)

```tsx
{visibleEvents.map((event, index) => {
  const tag = event.type === 'ReleaseEvent'
    ? (event.payload as { release: { tag_name: string } }).release.tag_name
    : null
  return (
    <ActivityModalEntry
      key={event.id}
      event={event}
      onClose={onClose}
      eager={index === 0}
      onLearnVersion={onLearnVersion}
      learnState={tag && versionLearnStates ? versionLearnStates.get(tag) : undefined}
      alreadyLearned={tag && versionedLearns ? versionedLearns.has(tag) : false}
    />
  )
})}
```

### 3.4 `ActivityModalEntry` → `ReleaseModalContent` (current line 213-215)

```tsx
<div className="activity-modal__body">
  {event.type === 'ReleaseEvent'
    ? <ReleaseModalContent
        event={event}
        onLearnVersion={onLearnVersion}
        learnState={learnState}
        alreadyLearned={alreadyLearned}
      />
    : <PullRequestModalContent event={event} />}
</div>
```

`PullRequestModalContent` is unchanged. Library-feed call sites of `ActivityModal` (today: `ActivityFeed.tsx`) don't pass the new props → `learnState`/`alreadyLearned` arrive as `undefined`/`false`, no install button rendered, behaviour identical to today.

## 4. Icon Swaps (RepoArticleActionRow)

`src/views/RepoDetail.tsx:3` (imports), `:1855-1907` (render).

### 4.1 Imports

```diff
- import { Brain, FileDown, GitBranch, GitFork } from 'lucide-react'
+ import { FileDown } from 'lucide-react'
+ import { PiBrainFill, PiGitBranchFill, PiStarFill, PiStar, PiGitForkFill } from 'react-icons/pi'
```

`FileDown` stays — used elsewhere in the file for release assets (which now live in `ReleaseModalContent`, but that's a separate import). After the Activities work moves the assets render, `FileDown` may become unused in `RepoDetail.tsx`; remove the import then if so.

### 4.2 Button icon swaps

| Button | Line | Old | New |
|---|---|---|---|
| Learn | ~1858 | `<Brain size={14} />` | `<PiBrainFill size={14} />` |
| Clone | ~1880 | `<GitBranch size={14} />` | `<PiGitBranchFill size={14} />` |
| Star | ~1888-1898 | inline `<svg>` with `fill={starred ? 'currentColor' : 'none'}` | `{starred ? <PiStarFill size={14} /> : <PiStar size={14} />}` |
| Fork | ~1903 | `<GitFork size={14} />` | `<PiGitForkFill size={14} />` |

The Star inline-SVG block (~10 lines) is deleted entirely.

No CSS changes — colours continue to inherit via `currentColor`, sizes remain `14`.

## 5. README Mentions Removal

Pure deletion across four files. No new logic.

### 5.1 `src/components/ReadmeRenderer.tsx`

Delete:
- Lines 134-153 — comment block, `MENTIONS_HEADINGS` regex, `isMentionsHeading()` helper
- Lines 155-307 — `rehypeExtractMentions()` function
- Line 1506 — plugin registration in the rehype pipeline (`rehypeExtractMentions,`)
- Lines 571-572 — the `if (node.properties?.dataMention) return SKIP` guard inside the other rehype visitor (dead code with no `dataMention` nodes ever produced)

Net removal: ~175 LOC.

### 5.2 `src/components/ReadmeRenderer.test.tsx`

Delete the entire `describe('mentions section extraction', …)` block at lines 680-725 (three `it()` blocks):
- Line 681 — `'extracts Contributors links into a flat Mentions list'`
- Line 705 — `'does not create rm-mentions section when no acknowledgment headings exist'`
- Line 713 — `'extracts multiple acknowledgment sections into a single Mentions list'`

Net removal: ~46 LOC. No replacement tests — other ReadmeRenderer tests already verify normal heading rendering, which is the post-removal behaviour.

### 5.3 `src/styles/globals.css`

Delete lines 3819-3847:
- `.rm-mentions`
- `.rm-mentions-heading`
- `.rm-mentions-list`
- `.rm-mention-link`
- `.rm-mention-link:hover`
- `.rm-mentions + .rm-references`

Net removal: ~30 LOC.

### 5.4 No other consumers

Grep verified: `rm-mention*` and `dataMention` are referenced only in the three files above. No leakage.

### 5.5 Resulting README behaviour

Contributor / Sponsor / Backer / Acknowledgments / Built-with / Powered-by sections render inline at the position the README author wrote them. Any `@user` text inside renders as the author wrote it — link if formatted as a markdown link, plain text otherwise. No "Mentions" section is appended. No new `@user` auto-linking is added.

## 6. Testing

TDD where tests already exist. User handles UI verification themselves — no dev server / screenshots from the implementer. Existing-tests-deleted go in a separate commit so the suite is green before new functionality lands.

### 6.1 New tests in `src/views/RepoDetail.test.tsx`

Extend the existing `getReleases` mock setup:

- Default tab is `'activities'` when `getReleases` resolves with ≥ 1 release.
- Default tab falls back to `'readme'` when `getReleases` resolves with `[]`.
- Default tab falls back to `'readme'` when `getReleases` rejects.
- Activities tab is in the tab strip iff releases is non-empty.
- Clicking a release card opens `ActivityModal` (assert via test id or modal heading).
- Pure adapter test: `releaseRowToFeedEvent` produces correct `id`, `type`, `repo.full_name`, `payload.release.{tag_name, name, body, prerelease, assets}`, `created_at`.

### 6.2 New tests in `src/components/ReleaseModalContent.test.tsx`

- `onLearnVersion` absent → no install button in the DOM (preserves Library feed).
- `onLearnVersion` provided + `learnState='UNLEARNED'` + `alreadyLearned=false` → "Learn this version" button rendered, calls `onLearnVersion(tag)` on click.
- `learnState='LEARNING'` → installing label rendered, no clickable button.
- `learnState='ERROR'` → "Failed — retry" button rendered, calls `onLearnVersion(tag)` on click.
- `alreadyLearned=true` → installed label rendered (`{repoName}@{safeTag}.skill.md`), no button.
- `onLearnVersion` provided + `assets` non-empty → assets list rendered with each asset's name and size.
- `onLearnVersion` provided + `assets` empty/undefined → no assets list.
- `onLearnVersion` absent + `assets` non-empty → no assets list (Library feed unchanged).

### 6.3 New test in `src/components/ActivityModal.test.tsx`

- `onLearnVersion` / `versionLearnStates` / `versionedLearns` props are forwarded to `ReleaseModalContent` for `ReleaseEvent` types. (Mock `ReleaseModalContent` and assert it receives the props, consistent with existing test style at line 19.)

### 6.4 Tests deleted

The three `it()` blocks inside `describe('mentions section extraction', …)` at `ReadmeRenderer.test.tsx:680-725` (lines 681, 705, 713). No replacements.

### 6.5 Verification at the end

Run `npm test` and post the result before declaring done. User verifies visuals on their machine.

## 7. Implementation Sequencing

Recommended commit order — each commit leaves the suite green:

1. **Mentions removal** — delete plugin + tests + CSS together. Suite stays green; behaviour change is just "those sections render inline now."
2. **Icon swaps** — pure visual change, no test impact.
3. **ReleaseModalContent install button + assets** — new optional props, no behaviour change at existing call sites. Add tests first (TDD), then implement.
4. **ActivityModal prop forwarding** — small change, tested in isolation.
5. **Activities tab** — biggest change. Add tests first, then:
   - Tab type / ALL_TABS swap
   - Default-tab effect + visibility rule
   - Synthetic adapter
   - Body render replacement
   - Modal wiring
   - Delete dead state (`expandedReleases`)
6. **Cleanup pass** — remove now-unused imports (`FileDown` likely; `sanitiseRef` if no longer needed in `RepoDetail.tsx`), run `npm test`.

Branch policy: work directly on `main` per project rules. No feature branch.

## 8. Out of Scope

- Per-repo GitHub event-stream fetching (forks, stars, PRs). Activities tab is release-events-only by design (Q1 option A).
- @user auto-linking in READMEs. Confirmed not requested (Q5).
- Library feed install button. Library release modals stay informational (Q3 option A scoped to per-repo only).
- Tab strip reordering beyond placing Activities first. All other tabs keep their relative order.
- New IPC methods. Everything reuses `getReleases`.
