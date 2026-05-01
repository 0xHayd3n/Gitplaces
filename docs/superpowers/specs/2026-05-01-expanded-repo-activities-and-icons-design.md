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
| `src/components/ReleaseModalContent.tsx` | New optional props: install button + assets list |
| `src/components/ActivityModal.tsx` | Pipe install props through to `ReleaseModalContent` |
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
    actor: { login: '', avatar_url: '' },     // BannerCard derives the avatar from repo owner
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

`actor.login`/`actor.avatar_url` are empty strings because `BannerCard` doesn't read them — `releaseToBannerProps` derives the avatar from `event.repo.full_name` via `repoOwnerAvatarUrl()`. We still satisfy the type.

### 1.5 Activities tab body

Replaces the entire `activeTab === 'releases'` block at `RepoDetail.tsx:1488-1576`.

```tsx
{activeTab === 'activities' && (
  releases === 'loading' ? (
    <p className="repo-detail-placeholder">Loading activity…</p>
  ) : releases === 'error' ? (
    <p className="repo-detail-placeholder">Failed to load activity.</p>
  ) : (
    <div className="repo-activity-feed">
      {(releases as ReleaseRow[]).map(r => {
        const event = releaseRowToFeedEvent(r, `${owner}/${name}`)
        return (
          <BannerCard
            key={r.tag_name}
            {...releaseToBannerProps(event, () => setSelectedActivityEvent(event))}
          />
        )
      })}
    </div>
  )
)}

{selectedActivityEvent && (
  <ActivityModal
    event={selectedActivityEvent}
    onClose={() => setSelectedActivityEvent(null)}
    onLearnVersion={handleVersionLearn}
    versionLearnStates={versionLearnStates}
    versionedLearns={versionedLearns}
  />
)}
```

`releaseToBannerProps` is currently defined as a non-exported function in `ActivityEvent.tsx:47-67` — export it (or move it to a shared util file `src/utils/releaseToBannerProps.ts`). Decision: **export from `ActivityEvent.tsx`** to minimise touch surface; future extraction is cheap.

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

`src/components/ActivityModal.tsx:214`. Three new optional props on `ActivityModal`, piped to `ReleaseModalContent` only for `ReleaseEvent` types.

```ts
interface ActivityModalProps {
  event: GitHubFeedEvent | null
  onClose: () => void
  // New:
  onLearnVersion?: (tag: string) => void
  versionLearnStates?: Map<string, VersionLearnState>
  versionedLearns?: Set<string>
}
```

When rendering `ReleaseModalContent` (existing line 214):

```tsx
<ReleaseModalContent
  event={event}
  onLearnVersion={onLearnVersion}
  learnState={versionLearnStates?.get(tagFromEvent(event))}
  alreadyLearned={versionedLearns?.has(tagFromEvent(event))}
/>
```

`tagFromEvent` extracts `event.payload.release.tag_name` — small inline helper.

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

Delete the three tests at:
- Line 686 — `'extracts acknowledgment links into rm-mentions section'`
- Line 705 — `'does not create rm-mentions section when no acknowledgment headings exist'`
- Line 718 — `'extracts text-only mentions when items have no links'`

Net removal: ~50 LOC. No replacement tests — other ReadmeRenderer tests already verify normal heading rendering, which is the post-removal behaviour.

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

3 `rm-mentions*` tests in `ReadmeRenderer.test.tsx` (lines 686, 705, 718). No replacements.

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
