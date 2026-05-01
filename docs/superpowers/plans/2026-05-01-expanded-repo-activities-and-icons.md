# Expanded Repo: Activities Tab, Solid Icons, README Mentions Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make three independent changes to the expanded repo view (`src/views/RepoDetail.tsx`) — replace the Releases tab with an Activities tab using `BannerCard`, swap Learn/Star/Fork/Clone icons to Phosphor Fill, and delete the README mentions-section extraction plugin.

**Architecture:** Same release data (`getReleases`) feeds both the existing Releases UI and the new Activities feed via a `releaseRowToFeedEvent` adapter that produces synthetic `GitHubFeedEvent` objects compatible with `BannerCard` and the existing panel-based `ActivityModal`. Install action moves into the modal via new optional props on `ReleaseModalContent` and `ActivityModal` — Library-feed call sites omit them and behave unchanged. README contributor/sponsor sections render inline at their authored positions after the rehype plugin and its CSS/tests are deleted.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, electron-vite, lucide-react (existing), `react-icons/pi` (Phosphor — existing), `react-markdown` + rehype/remark plugins (existing).

**Spec:** `docs/superpowers/specs/2026-05-01-expanded-repo-activities-and-icons-design.md`

**Branch policy:** Work directly on `main` per project CLAUDE.md. **Do NOT** create a feature branch or worktree. Each task below is one commit.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `src/components/ReadmeRenderer.tsx` | README rendering pipeline | Delete `rehypeExtractMentions` plugin + helpers + registration + dead `dataMention` SKIP guard |
| `src/components/ReadmeRenderer.test.tsx` | README rendering tests | Delete the 3-test `describe('mentions section extraction', …)` block |
| `src/styles/globals.css` | Global styles | Delete `.rm-mentions*` selectors |
| `src/views/RepoDetail.tsx` | Expanded repo view | (a) icon swaps in `RepoArticleActionRow`; (b) tab type/list swap, default-tab effect, visibility rule, synthetic adapter, Activities body + modal wiring; (c) drop `expandedReleases` state |
| `src/views/RepoDetail.test.tsx` | Expanded repo tests | New tests: default tab, tab visibility, modal opening, `releaseRowToFeedEvent` shape |
| `src/components/ActivityEvent.tsx` | Library feed event router | Export the `releaseToBannerProps` helper |
| `src/components/ReleaseModalContent.tsx` | Modal body for releases | New optional props: `onLearnVersion`, `learnState`, `alreadyLearned`. Render install button + assets list when `onLearnVersion` is provided |
| `src/components/ReleaseModalContent.test.tsx` | Modal body tests | New cases for install button states + assets list |
| `src/components/ActivityModal.tsx` | Panel-based modal stack | New optional props on `ActivityModal` and `ActivityModalEntry`; thread through to `ReleaseModalContent` |
| `src/components/ActivityModal.test.tsx` | Modal stack tests | One new case: forwards install props to `ReleaseModalContent` |

No new files.

## Verification commands

- Run a single test file: `npx vitest run path/to/file.test.tsx`
- Run a single test by name: `npx vitest run path/to/file.test.tsx -t "test name"`
- Full suite (final): `npm test` (rebuilds `better-sqlite3`, slow — only at the end)

After every task: run `npx vitest run` (full suite without rebuild) and only commit when green.

---

## Task 1: Remove README mentions extraction

**Files:**
- Modify: `src/components/ReadmeRenderer.test.tsx:680-725` (delete describe block)
- Modify: `src/components/ReadmeRenderer.tsx:134-153, 155-307, 571-572, 1506` (delete plugin + registration + dead guard)
- Modify: `src/styles/globals.css:3819-3847` (delete `.rm-mentions*` selectors)

No new tests — this is pure deletion. Other ReadmeRenderer tests already verify normal heading rendering, which is the post-removal behaviour.

- [ ] **Step 1.1: Delete the mentions describe block from `ReadmeRenderer.test.tsx`**

  Delete lines 680-725 inclusive — the entire `describe('mentions section extraction', () => { ... })` block (3 `it()` blocks). Verify the surrounding tests at line 727+ (`describe('GitHub repo link behaviour', …)`) and the prior tests (ending at line 678) remain intact.

- [ ] **Step 1.2: Delete `rehypeExtractMentions` and helpers from `ReadmeRenderer.tsx`**

  Delete lines 134-307 (one contiguous block: comment + `MENTIONS_HEADINGS` regex + `isMentionsHeading()` helper + `rehypeExtractMentions()` plugin). Net removal: ~175 LOC.

- [ ] **Step 1.3: Delete the plugin registration**

  Find `rehypeExtractMentions,` (originally line 1506; line number shifts after step 1.2) in the rehype plugins list. Delete the line. Verify the surrounding plugin entries remain.

- [ ] **Step 1.4: Delete the dead `dataMention` SKIP guard**

  Find the block (originally lines 571-572) inside another rehype visitor:
  ```ts
  // Skip Mentions links — they're already in the streamlined Mentions section
  if (node.properties?.dataMention) return SKIP
  ```
  Delete both lines (the comment and the if).

- [ ] **Step 1.5: Delete `.rm-mentions*` CSS from `globals.css`**

  Delete lines 3819-3851 (the full ruleset block — line 3847 is the opening of the last selector `.rm-mentions + .rm-references`, whose closing `}` is at line 3851). Six selectors total: `.rm-mentions`, `.rm-mentions-heading`, `.rm-mentions-list`, `.rm-mention-link`, `.rm-mention-link:hover`, `.rm-mentions + .rm-references`. Net removal: ~33 LOC.

  After deletion, grep to confirm no orphaned `rm-mention*` references remain:
  ```bash
  grep -n "rm-mention" src/styles/globals.css
  ```
  Expected: zero matches.

- [ ] **Step 1.6: Run `ReadmeRenderer` tests**

  Run: `npx vitest run src/components/ReadmeRenderer.test.tsx`
  Expected: PASS (with three fewer tests than before).

- [ ] **Step 1.7: Run full suite**

  Run: `npx vitest run`
  Expected: All tests pass. Confirm no other test was relying on `rm-mentions*` classes (grep already verified — should be clean).

- [ ] **Step 1.8: Commit**

  ```bash
  git add src/components/ReadmeRenderer.tsx src/components/ReadmeRenderer.test.tsx src/styles/globals.css
  git commit -m "feat(readme): remove mentions-section extraction

  Delete rehypeExtractMentions plugin, its registration, the dead
  dataMention SKIP guard, the rm-mentions* CSS, and the three tests
  that asserted on the extracted Mentions section. Contributor /
  Sponsor / Backer / Acknowledgments sections now render inline at
  the position the README author wrote them. Supersedes
  2026-04-15-mentions-section-design.md."
  ```

---

## Task 2: Swap to Phosphor Fill icons in `RepoArticleActionRow`

**Files:**
- Modify: `src/views/RepoDetail.tsx:3` (imports), `:1855-1907` (4 button icons)

Pure visual change. No test impact (no behaviour-level test asserts on these icons).

- [ ] **Step 2.1: Update imports at `RepoDetail.tsx:3`**

  ```diff
  - import { Brain, FileDown, GitBranch, GitFork } from 'lucide-react'
  + import { FileDown } from 'lucide-react'
  + import { PiBrainFill, PiGitBranchFill, PiStarFill, PiStar, PiGitForkFill } from 'react-icons/pi'
  ```

  `FileDown` stays — used for asset rows lower in the file. (After Task 6 it may become unused; cleanup happens there.)

- [ ] **Step 2.2: Swap the Learn button icon (around line 1872)**

  Find the JSX inside the Learn button rendering `<Brain size={14} />`. Replace with:
  ```tsx
  <PiBrainFill size={14} />
  ```

- [ ] **Step 2.3: Swap the Clone button icon (around line 1884)**

  Find `<GitBranch size={14} />`. Replace with:
  ```tsx
  <PiGitBranchFill size={14} />
  ```

- [ ] **Step 2.4: Replace the Star inline SVG (around lines 1894-1896)**

  The current Star button contains an inline `<svg>...</svg>` with `fill={starred ? 'currentColor' : 'none'}` and stroke paths. Delete the entire inline SVG (~10 lines) and replace with:
  ```tsx
  {starred ? <PiStarFill size={14} /> : <PiStar size={14} />}
  ```

- [ ] **Step 2.5: Swap the Fork button icon (around line 1905)**

  Find `<GitFork size={14} />`. Replace with:
  ```tsx
  <PiGitForkFill size={14} />
  ```

- [ ] **Step 2.6: Run `RepoDetail` tests**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Expected: PASS — the existing tests assert text labels (`+ Learn`, `✓ Learned`), not icon presence.

- [ ] **Step 2.7: Run full suite**

  Run: `npx vitest run`
  Expected: PASS.

- [ ] **Step 2.8: Commit**

  ```bash
  git add src/views/RepoDetail.tsx
  git commit -m "feat(repo-detail): swap action-row icons to Phosphor Fill

  Learn / Clone / Star / Fork buttons in RepoArticleActionRow now use
  Phosphor's Fill weight via react-icons/pi (already a codebase
  convention) instead of Lucide outline icons. Star's custom inline
  SVG with fill toggle is replaced by PiStarFill / PiStar."
  ```

---

## Task 3: Add install button and assets list to `ReleaseModalContent` (TDD)

**Files:**
- Test: `src/components/ReleaseModalContent.test.tsx`
- Modify: `src/components/ReleaseModalContent.tsx`

Add new optional props `onLearnVersion`, `learnState`, `alreadyLearned`. When `onLearnVersion` is provided, render install button (states: UNLEARNED / LEARNING / ERROR / installed-label) and assets list. When absent, render nothing new — Library-feed behaviour preserved.

### TDD: write all failing tests first, then implement

- [ ] **Step 3.1: Update `makeEvent` in the test file to support assets**

  The existing `makeEvent` helper (lines 18-25) doesn't include `assets`. Replace with a version that takes optional assets:

  ```ts
  const makeEvent = (
    body: string,
    opts: { tag?: string; assets?: Array<{ name: string; size: number; browser_download_url: string; download_count: number }> } = {}
  ): GitHubFeedEvent => ({
    id: '1',
    type: 'ReleaseEvent',
    actor: { login: 'maintainer', avatar_url: '' },
    repo: { full_name: 'acme/widget' },
    payload: {
      release: {
        tag_name: opts.tag ?? 'v1.2.3',
        name: opts.tag ?? 'v1.2.3',
        body,
        ...(opts.assets ? { assets: opts.assets } : {}),
      },
    },
    created_at: new Date().toISOString(),
  })
  ```

  Existing tests still pass — they call `makeEvent(body)` and the new options are optional.

- [ ] **Step 3.2: Add the install-button test cases (failing tests)**

  Append to the existing `describe('ReleaseModalContent', ...)` block in `ReleaseModalContent.test.tsx`. Use these new tests:

  ```tsx
  it('renders no install button when onLearnVersion is absent', async () => {
    render(<ReleaseModalContent event={makeEvent('notes')} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText('Learn this version')).toBeNull()
    expect(screen.queryByText(/Failed — retry/)).toBeNull()
    expect(screen.queryByText('Learning…')).toBeNull()
  })

  it('renders "Learn this version" button when UNLEARNED and not already learned', async () => {
    const onLearn = vi.fn()
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={onLearn}
        learnState="UNLEARNED"
        alreadyLearned={false}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Learn this version'))
    expect(onLearn).toHaveBeenCalledWith('v1.2.3')
  })

  it('renders "Learning…" label and no clickable button when LEARNING', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={vi.fn()}
        learnState="LEARNING"
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText('Learning…')).toBeInTheDocument()
    expect(screen.queryByText('Learn this version')).toBeNull()
  })

  it('renders "Failed — retry" button when ERROR and calls onLearnVersion on click', async () => {
    const onLearn = vi.fn()
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={onLearn}
        learnState="ERROR"
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Failed — retry/))
    expect(onLearn).toHaveBeenCalledWith('v1.2.3')
  })

  it('renders installed label and no button when alreadyLearned is true', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes')}
        onLearnVersion={vi.fn()}
        alreadyLearned
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText(/widget@v1\.2\.3\.skill\.md/)).toBeInTheDocument()
    expect(screen.queryByText('Learn this version')).toBeNull()
  })
  ```

  You'll need to add `fireEvent` to the imports at the top of the file:
  ```ts
  import { render, screen, waitFor, fireEvent } from '@testing-library/react'
  ```

- [ ] **Step 3.3: Add the assets-list test cases (failing tests)**

  Append to the same `describe` block:

  ```tsx
  it('renders assets list when onLearnVersion is provided and assets are present', async () => {
    const assets = [
      { name: 'widget-darwin.zip', size: 1048576, browser_download_url: 'https://x/y', download_count: 12 },
      { name: 'widget-linux.tar.gz', size: 2097152, browser_download_url: 'https://x/z', download_count: 0 },
    ]
    render(
      <ReleaseModalContent
        event={makeEvent('notes', { assets })}
        onLearnVersion={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.getByText('widget-darwin.zip')).toBeInTheDocument()
    expect(screen.getByText('widget-linux.tar.gz')).toBeInTheDocument()
  })

  it('does not render assets list when onLearnVersion is provided but assets are empty', async () => {
    render(
      <ReleaseModalContent
        event={makeEvent('notes', { assets: [] })}
        onLearnVersion={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText(/Assets/i)).toBeNull()
  })

  it('does not render assets list when onLearnVersion is absent (Library-feed mode)', async () => {
    const assets = [
      { name: 'widget-darwin.zip', size: 1048576, browser_download_url: 'https://x/y', download_count: 0 },
    ]
    render(<ReleaseModalContent event={makeEvent('notes', { assets })} />)
    await waitFor(() => expect(screen.getByTestId('readme')).toBeInTheDocument())
    expect(screen.queryByText('widget-darwin.zip')).toBeNull()
  })
  ```

- [ ] **Step 3.4: Run the new tests — verify they FAIL**

  Run: `npx vitest run src/components/ReleaseModalContent.test.tsx`
  Expected: 8 new tests fail; 5 existing tests pass.

- [ ] **Step 3.5: Update the `ReleasePayload` interface in `ReleaseModalContent.tsx`**

  Find the `ReleasePayload` interface near line 9. Extend with optional `prerelease` and `assets`:

  ```ts
  interface ReleasePayload {
    release: {
      tag_name: string
      name?: string | null
      body?: string | null
      prerelease?: boolean | null
      assets?: Array<{
        name: string
        size: number
        browser_download_url: string
        download_count: number
      }>
    }
  }
  ```

- [ ] **Step 3.6: Add the new optional props to the `Props` interface**

  Replace the existing `Props` interface (around line 17):

  ```ts
  type VersionLearnState = 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'

  interface Props {
    event: GitHubFeedEvent
    onLearnVersion?: (tag: string) => void
    learnState?: VersionLearnState
    alreadyLearned?: boolean
  }
  ```

  Export the `VersionLearnState` type — it's reused by `ActivityModal` in Task 4:

  ```ts
  export type VersionLearnState = 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'
  ```

- [ ] **Step 3.7: Add `sanitiseRef` import**

  At the top of `ReleaseModalContent.tsx`, add:
  ```ts
  import { sanitiseRef } from '../../electron/sanitiseRef'
  ```
  (Mirrors the existing import in `RepoDetail.tsx:55`.)

- [ ] **Step 3.8: Extract `formatBytes` to a shared util**

  `formatBytes` currently lives non-exported in `RepoDetail.tsx:330-335`. Both `RepoDetail.tsx` (until Task 5 deletes the assets render there) and `ReleaseModalContent.tsx` (the new assets list) need it. Extract once now to keep the import shape clean.

  Create `src/utils/formatBytes.ts` with the function copied verbatim from `RepoDetail.tsx:330-335` plus an `export`:

  ```ts
  export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
  ```

  (Verify the exact body against `RepoDetail.tsx:330-335` — copy the real implementation, not the example above. The example shows the expected shape; the file may differ.)

  Delete the inline definition from `RepoDetail.tsx`. Add the import to both `RepoDetail.tsx` and `ReleaseModalContent.tsx`:
  ```ts
  import { formatBytes } from '../utils/formatBytes'
  ```

  (Note: `LocalProjectDetail.tsx:16` has its own non-exported `formatBytes` — leave it alone for this work; consolidating is a separate concern.)

- [ ] **Step 3.9: Update the `ReleaseModalContent` function signature and destructure new props**

  Replace the existing function header (around line 21):

  ```tsx
  export function ReleaseModalContent({ event, onLearnVersion, learnState, alreadyLearned }: Props) {
    const release = (event.payload as unknown as ReleasePayload).release
    // ...existing body parsing...
    const tag = release.tag_name
    const safeTag = sanitiseRef(tag)
    const repoName = event.repo.full_name.split('/')[1] ?? ''
    const showInstall = onLearnVersion !== undefined
    const assets = release.assets ?? []
    const showAssets = showInstall && assets.length > 0
    // ...rest of existing return with additions below...
  ```

- [ ] **Step 3.10: Render the install button conditionally**

  In the JSX returned from `ReleaseModalContent`, after the existing body block and before `<CompareSummary>`, insert:

  ```tsx
  {showInstall && (
    <div className="repo-release-install" style={{ marginTop: 12 }}>
      {alreadyLearned ? (
        <span className="repo-release-installed-label">{repoName}@{safeTag}.skill.md</span>
      ) : learnState === 'LEARNING' ? (
        <span className="repo-release-installing-label">Learning…</span>
      ) : learnState === 'ERROR' ? (
        <button
          className="repo-release-install-btn repo-release-install-btn--error"
          onClick={() => onLearnVersion!(tag)}
        >
          Failed — retry
        </button>
      ) : (
        <button
          className="repo-release-install-btn"
          onClick={() => onLearnVersion!(tag)}
        >
          Learn this version
        </button>
      )}
    </div>
  )}
  ```

  (The inline `style={{ marginTop: 12 }}` is a stand-in; refine to a CSS class if it clashes with existing layout in the modal. The tests don't assert on layout.)

- [ ] **Step 3.11: Render the assets list conditionally**

  After the install block, insert:

  ```tsx
  {showAssets && (
    <div className="repo-release-assets">
      <div className="repo-release-assets-label">Assets</div>
      {assets.map(a => (
        <a
          key={a.name}
          className="repo-release-asset"
          href={a.browser_download_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="repo-release-asset-name">{a.name}</span>
          <span className="repo-release-asset-size">{formatBytes(a.size)}</span>
          {a.download_count > 0 && (
            <span className="repo-release-asset-downloads">{a.download_count.toLocaleString()} downloads</span>
          )}
        </a>
      ))}
    </div>
  )}
  ```

  (Mirrors the existing `repo-release-assets` block at `RepoDetail.tsx:1543-1559`. Reuses the same CSS classes — they already exist in `globals.css`.)

- [ ] **Step 3.12: Run `ReleaseModalContent` tests — verify all PASS**

  Run: `npx vitest run src/components/ReleaseModalContent.test.tsx`
  Expected: 13 tests pass (5 existing + 8 new).

- [ ] **Step 3.13: Run full suite**

  Run: `npx vitest run`
  Expected: PASS. (Library `ActivityFeed.tsx` callers pass no install props; default behaviour unchanged.)

- [ ] **Step 3.14: Commit**

  ```bash
  git add src/components/ReleaseModalContent.tsx src/components/ReleaseModalContent.test.tsx
  git commit -m "feat(release-modal): optional install button and assets list

  ReleaseModalContent gains optional onLearnVersion, learnState, and
  alreadyLearned props. When onLearnVersion is provided, renders the
  Learn-this-version button (with LEARNING / ERROR / installed states)
  and the release's downloadable assets list — mirroring the inline
  affordances on the existing Releases tab. Library-feed callers omit
  these props and behaviour is unchanged."
  ```

---

## Task 4: Thread install props through `ActivityModal` (TDD)

**Files:**
- Test: `src/components/ActivityModal.test.tsx`
- Modify: `src/components/ActivityModal.tsx`

Add new optional props on `ActivityModal` and `ActivityModalEntry`. Per-entry, derive `learnState` and `alreadyLearned` from `versionLearnStates` Map and `versionedLearns` Set using the event's `release.tag_name`.

- [ ] **Step 4.1: Update the `ReleaseModalContent` mock in the test file**

  The existing mock at `ActivityModal.test.tsx:19` ignores props. Update so we can assert which props were forwarded:

  ```ts
  const releaseContentSpy = vi.fn()
  vi.mock('./ReleaseModalContent', () => ({
    ReleaseModalContent: (props: Record<string, unknown>) => {
      releaseContentSpy(props)
      return <div data-testid="release-content" />
    },
  }))
  ```

  Add `releaseContentSpy.mockClear()` to the `beforeEach` block (line 51).

- [ ] **Step 4.2: Add the prop-forwarding test (failing)**

  Append to the `describe('ActivityModal', ...)` block:

  ```tsx
  it('forwards onLearnVersion, learnState, and alreadyLearned to ReleaseModalContent', () => {
    const onLearnVersion = vi.fn()
    const versionLearnStates = new Map<string, 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'>([
      ['v19.0.0', 'LEARNING'],
    ])
    const versionedLearns = new Set<string>(['v19.0.0'])
    render(
      <MemoryRouter>
        <ActivityModal
          events={[releaseEvent]}
          initialEventId={releaseEvent.id}
          onClose={vi.fn()}
          onLearnVersion={onLearnVersion}
          versionLearnStates={versionLearnStates}
          versionedLearns={versionedLearns}
        />
      </MemoryRouter>
    )
    expect(releaseContentSpy).toHaveBeenCalled()
    const props = releaseContentSpy.mock.calls[0][0]
    expect(props.onLearnVersion).toBe(onLearnVersion)
    expect(props.learnState).toBe('LEARNING')
    expect(props.alreadyLearned).toBe(true)
  })

  it('passes learnState=undefined and alreadyLearned=false when no version maps are provided', () => {
    render(
      <MemoryRouter>
        <ActivityModal
          events={[releaseEvent]}
          initialEventId={releaseEvent.id}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    )
    const props = releaseContentSpy.mock.calls[0][0]
    expect(props.onLearnVersion).toBeUndefined()
    expect(props.learnState).toBeUndefined()
    expect(props.alreadyLearned).toBe(false)
  })
  ```

- [ ] **Step 4.3: Run new tests — verify they FAIL**

  Run: `npx vitest run src/components/ActivityModal.test.tsx`
  Expected: 2 new tests fail (the props aren't forwarded yet); existing tests pass.

- [ ] **Step 4.4: Update the `ActivityModal` `Props` interface (lines 11-15)**

  ```ts
  import type { VersionLearnState } from './ReleaseModalContent'

  interface Props {
    events: GitHubFeedEvent[]
    initialEventId: string
    onClose: () => void
    onLearnVersion?: (tag: string) => void
    versionLearnStates?: Map<string, VersionLearnState>
    versionedLearns?: Set<string>
  }
  ```

- [ ] **Step 4.5: Update the `EntryProps` interface (lines 90-94)**

  ```ts
  interface EntryProps {
    event: GitHubFeedEvent
    onClose: () => void
    eager?: boolean
    onLearnVersion?: (tag: string) => void
    learnState?: VersionLearnState
    alreadyLearned?: boolean
  }
  ```

- [ ] **Step 4.6: Update `ActivityModal` to derive per-entry props in the map (lines 268-275)**

  Replace the `visibleEvents.map` block:

  ```tsx
  {visibleEvents.map((event, index) => {
    const tag = event.type === 'ReleaseEvent'
      ? (event.payload as unknown as { release: { tag_name: string } }).release.tag_name
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

  Also destructure the new props in the `ActivityModal` function signature (line 238):

  ```tsx
  export function ActivityModal({
    events, initialEventId, onClose,
    onLearnVersion, versionLearnStates, versionedLearns,
  }: Props) {
  ```

- [ ] **Step 4.7: Update `ActivityModalEntry` to accept and forward the props**

  Update the function signature (line 118):

  ```tsx
  function ActivityModalEntry({
    event, onClose, eager = false,
    onLearnVersion, learnState, alreadyLearned,
  }: EntryProps) {
  ```

  Update the `ReleaseModalContent` call site (around line 213-215):

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

- [ ] **Step 4.8: Run `ActivityModal` tests — verify PASS**

  Run: `npx vitest run src/components/ActivityModal.test.tsx`
  Expected: All tests pass (existing + 2 new).

- [ ] **Step 4.9: Run full suite**

  Run: `npx vitest run`
  Expected: PASS. (Library `ActivityFeed.tsx` is unchanged — it doesn't pass the new props, so `learnState=undefined` / `alreadyLearned=false` flow through and `ReleaseModalContent` renders no install button.)

- [ ] **Step 4.10: Commit**

  ```bash
  git add src/components/ActivityModal.tsx src/components/ActivityModal.test.tsx
  git commit -m "feat(activity-modal): thread install props to ReleaseModalContent

  ActivityModal and ActivityModalEntry gain optional onLearnVersion,
  versionLearnStates, and versionedLearns props. Per-entry, the modal
  derives learnState (from the Map) and alreadyLearned (from the Set)
  using the release tag_name and forwards them to ReleaseModalContent.
  Library-feed callers omit the props and behaviour is unchanged."
  ```

---

## Task 5: Activities tab in `RepoDetail` (TDD)

**Files:**
- Modify: `src/components/ActivityEvent.tsx:47` (export `releaseToBannerProps`)
- Test: `src/views/RepoDetail.test.tsx`
- Modify: `src/views/RepoDetail.tsx` (Tab type, ALL_TABS, default tab + effect, visibility, adapter, body, modal wiring, dead-state cleanup)
- Modify: `src/styles/globals.css` (one new selector `.repo-activity-feed`)

This is the largest task. TDD: write the failing tests first across all required behaviours, then implement.

### 5.A — Tiny preliminary: export `releaseToBannerProps`

- [ ] **Step 5.1: Add `export` to `releaseToBannerProps` in `ActivityEvent.tsx:47`**

  Change:
  ```ts
  function releaseToBannerProps(...)
  ```
  to:
  ```ts
  export function releaseToBannerProps(...)
  ```

  No other change. Don't commit yet — bundle into the Task 5 commit.

### 5.B — Tests first

- [ ] **Step 5.2: Update the `setupDetail` helper in `RepoDetail.test.tsx`**

  The helper takes a hardcoded `getReleases: vi.fn().mockResolvedValue([])`. Make releases configurable so we can test the populated and empty paths:

  ```ts
  function setupDetail(
    skillRow: SkillRow | null,
    apiKey: string | null = null,
    generateFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ content: '## [CORE]\nfoo', version: 'v1' }),
    relatedRepos: object[] = [],
    releases: object[] | 'reject' = [],
  ) {
    const releasesFn = releases === 'reject'
      ? vi.fn().mockRejectedValue(new Error('boom'))
      : vi.fn().mockResolvedValue(releases)
    Object.defineProperty(window, 'api', {
      value: {
        github: {
          getRepo: vi.fn().mockResolvedValue(repoRow),
          getReleases: releasesFn,
          // ...rest of github stubs unchanged
  ```

  Existing tests at lines 107-191 still call `setupDetail(...)` without the 5th arg → defaults to `[]` → behaviour identical to today.

- [ ] **Step 5.3: Add a sample release fixture at the top of `RepoDetail.test.tsx`**

  After the `repoRow` constant:

  ```ts
  const sampleRelease = {
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    published_at: '2026-04-01T00:00:00Z',
    body: 'release notes',
    assets: [],
    prerelease: false,
  }
  ```

- [ ] **Step 5.4: Add a `describe('RepoDetail activities tab', …)` block with failing tests**

  Append to the file:

  ```tsx
  describe('RepoDetail activities tab', () => {
    it('shows the Activities tab and selects it by default when releases is non-empty', async () => {
      setupDetail(null, null, vi.fn(), [], [sampleRelease])
      await waitFor(() => screen.getAllByText('next.js'))
      const activitiesTab = await waitFor(() =>
        screen.getByRole('button', { name: 'Activities' })
      )
      // It's the active tab — assert via the BannerCard for the release showing.
      await waitFor(() => screen.getByText(/v1\.0\.0/))
      expect(activitiesTab).toBeInTheDocument()
    })

    it('hides the Activities tab and falls back to README default when releases is empty', async () => {
      setupDetail(null, null, vi.fn(), [], [])
      await waitFor(() => screen.getAllByText('next.js'))
      // Activities tab not in the strip
      expect(screen.queryByRole('button', { name: 'Activities' })).not.toBeInTheDocument()
      // README is the active tab — its placeholder/content area is visible.
      // (Existing tests already prove README is shown without specific assertion;
      // here we just confirm the tab strip omits Activities.)
    })

    it('hides Activities and falls back to README when getReleases rejects', async () => {
      setupDetail(null, null, vi.fn(), [], 'reject')
      await waitFor(() => screen.getAllByText('next.js'))
      expect(screen.queryByRole('button', { name: 'Activities' })).not.toBeInTheDocument()
    })

    it('opens the ActivityModal when a release card is clicked', async () => {
      setupDetail(null, null, vi.fn(), [], [sampleRelease])
      await waitFor(() => screen.getAllByText('next.js'))
      const card = await waitFor(() => screen.getByText(/v1\.0\.0/).closest('.banner-card'))
      expect(card).not.toBeNull()
      fireEvent.click(card!)
      // Modal renders — the close × button is a stable assertion target.
      await waitFor(() => screen.getByLabelText('Close'))
    })
  })
  ```

- [ ] **Step 5.5: Add a `describe('releaseRowToFeedEvent', …)` adapter test**

  This test asserts the pure adapter shape. Add at the top of the file (with the other unit tests like `parseSkillDepths`):

  ```tsx
  describe('releaseRowToFeedEvent', () => {
    it('maps a ReleaseRow to a synthetic ReleaseEvent with the expected shape', async () => {
      const { releaseRowToFeedEvent } = await import('./RepoDetail')
      const row = {
        tag_name: 'v2.0.0',
        name: 'Two Point Oh',
        published_at: '2026-03-15T12:00:00Z',
        body: 'big release',
        assets: [{ name: 'a.zip', size: 100, browser_download_url: 'u', download_count: 0 }],
        prerelease: false,
      }
      const event = releaseRowToFeedEvent(row, 'acme/widget')
      expect(event.id).toBe('release-v2.0.0')
      expect(event.type).toBe('ReleaseEvent')
      expect(event.repo.full_name).toBe('acme/widget')
      expect(event.created_at).toBe('2026-03-15T12:00:00Z')
      const release = (event.payload as any).release
      expect(release.tag_name).toBe('v2.0.0')
      expect(release.name).toBe('Two Point Oh')
      expect(release.body).toBe('big release')
      expect(release.prerelease).toBe(false)
      expect(release.assets).toHaveLength(1)
    })
  })
  ```

  This requires `RepoDetail.tsx` to export `releaseRowToFeedEvent` — that's part of the implementation steps below. It's fine for this test to live in `RepoDetail.test.tsx`.

- [ ] **Step 5.6: Run new tests — verify they FAIL**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Expected: All 5 new tests fail (no Activities tab exists yet, adapter not exported). Existing tests still pass — `setupDetail` with the new 5th arg defaulting to `[]` keeps them on the README default.

### 5.C — Implementation

- [ ] **Step 5.7: Update the `Tab` type and `ALL_TABS` (lines 416-428)**

  Replace:
  ```ts
  type Tab = 'readme' | 'files' | 'skill' | 'releases' | 'collections' | 'related' | 'videos' | 'posts' | 'commands' | 'components'
  const ALL_TABS: { id: Tab; label: string }[] = [
    { id: 'readme',      label: 'README' },
    { id: 'files',       label: 'Files' },
    { id: 'skill',       label: 'Skills Folder' },
    { id: 'releases',    label: 'Releases' },
    { id: 'collections', label: 'Collections' },
    { id: 'related',     label: 'Related' },
    { id: 'videos',      label: 'Videos' },
    { id: 'posts',       label: 'Posts' },
    { id: 'commands',    label: 'Commands' },
    { id: 'components',  label: 'Components' },
  ]
  ```
  with:
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

- [ ] **Step 5.8: Add and export `releaseRowToFeedEvent` near the top of `RepoDetail.tsx`**

  Place it after the `Tab` declarations (around line 429, just above the `RelatedRepo` interface):

  ```ts
  export function releaseRowToFeedEvent(r: ReleaseRow, repoFullName: string): GitHubFeedEvent {
    return {
      id: `release-${r.tag_name}`,
      type: 'ReleaseEvent',
      actor: { login: '', avatar_url: '' },
      repo: { full_name: repoFullName },
      payload: {
        release: {
          tag_name: r.tag_name,
          name: r.name,
          body: r.body,
          prerelease: r.prerelease,
          assets: r.assets,
        },
      },
      created_at: r.published_at,
    }
  }
  ```

  Add the `GitHubFeedEvent` import to the top of the file:
  ```ts
  import type { GitHubFeedEvent } from '../hooks/useFeed'
  ```

- [ ] **Step 5.9: Add `BannerCard`, `releaseToBannerProps`, and `ActivityModal` imports**

  At the top of `RepoDetail.tsx`:
  ```ts
  import { BannerCard } from '../components/BannerCard'
  import { releaseToBannerProps } from '../components/ActivityEvent'
  import { ActivityModal } from '../components/ActivityModal'
  ```

  (Verify `BannerCard` is a named export — `src/components/BannerCard.tsx:54` has `export function BannerCard`, so yes.)

- [ ] **Step 5.10: Change the default `activeTab` to `'activities'`**

  Find the line `const [activeTab, setActiveTab] = useState<Tab>('readme')` (line 470) and change to:
  ```ts
  const [activeTab, setActiveTab] = useState<Tab>('activities')
  ```

- [ ] **Step 5.11: Add the default-tab fallback effect**

  After the `setActiveTab` declaration, add the fallback effect:

  ```ts
  const fellBackRef = useRef(false)
  useEffect(() => {
    if (fellBackRef.current) return
    if (releases === 'loading') return
    fellBackRef.current = true
    const hasActivity = Array.isArray(releases) && (releases as ReleaseRow[]).length > 0
    if (!hasActivity && activeTab === 'activities') setActiveTab('readme')
  }, [releases, activeTab])
  ```

  Verify `useRef` is in the existing React import — `RepoDetail.tsx:1` has `import { useState, useEffect, useCallback, useRef, useMemo } from 'react'` (or similar). If `useRef`/`useEffect`/`useMemo` are missing from the import, add them.

- [ ] **Step 5.12: Add the `selectedReleaseId` state and `activityEvents` memo**

  Add near the other state declarations (around line 490):

  ```ts
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null)

  const activityEvents = useMemo(
    () => Array.isArray(releases)
      ? (releases as ReleaseRow[]).map(r => releaseRowToFeedEvent(r, `${owner}/${name}`))
      : [],
    [releases, owner, name],
  )
  ```

- [ ] **Step 5.13: Update the tab-visibility filter at lines 967-974**

  The existing block has rules per tab id. Add a rule for `'activities'`:

  ```ts
  if (t.id === 'activities') {
    if (releases === 'loading') return true
    return Array.isArray(releases) && releases.length > 0
  }
  ```

  Remove the existing `if (t.id === 'releases') ...` rule (it no longer applies — the `'releases'` id is gone from `Tab`).

- [ ] **Step 5.14: Replace the `activeTab === 'releases'` body block (lines 1488-1579) with the Activities body**

  Locate the entire block beginning with `{activeTab === 'releases' && (` and ending at its closing `)}`. Replace with:

  ```tsx
  {activeTab === 'activities' && (
    releases === 'loading' ? (
      <p className="repo-detail-placeholder">Loading activity…</p>
    ) : releases === 'error' ? (
      <p className="repo-detail-placeholder">Failed to load activity.</p>
    ) : (releases as ReleaseRow[]).length === 0 ? (
      // Defensive: the visibility rule (Step 5.13) normally hides the
      // Activities tab when releases is empty, so this branch is reached
      // only if the user explicitly clicks Activities while on a no-release
      // repo (which the tab strip wouldn't expose). Kept as a safe fallback.
      <p className="repo-detail-placeholder">No activity yet.</p>
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
  ```

- [ ] **Step 5.15: Add the `ActivityModal` mount at the bottom of the rendered component tree**

  Find the outermost return's closing `</...>` (where the component tree ends in `RepoDetail`'s render). Just before the final fragment/element close, add:

  ```tsx
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

- [ ] **Step 5.16: Add `.repo-activity-feed` CSS to `globals.css`**

  Append to `src/styles/globals.css`:
  ```css
  /* ── Activities tab feed (per-repo release stream) ─────── */
  .repo-activity-feed {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  ```

  (12px is a starting value; verify visually against the Library's `ActivityFeed` gap during testing. Adjustment is a one-line change.)

- [ ] **Step 5.17: Delete the dead `expandedReleases` state**

  The expand-inline behaviour is gone (full body lives in the modal now). Find and delete:
  - The state declaration: `const [expandedReleases, setExpandedReleases] = useState<Set<string>>(new Set())` (line 491)
  - Any remaining references — there should be none after Step 5.14 replaces the releases block.

  Run a quick grep to confirm:
  ```bash
  grep -n "expandedReleases" src/views/RepoDetail.tsx
  ```
  Expected: zero matches after the deletion.

- [ ] **Step 5.18: Pre-emptively mock `DitherBackground` in `RepoDetail.test.tsx`**

  `BannerCard.tsx:1` imports `DitherBackground` directly (not lazily), so rendering BannerCards in the test will hit it and may fail in jsdom. Add this mock at the top of `RepoDetail.test.tsx` (alongside the existing imports/mocks):

  ```ts
  vi.mock('../components/DitherBackground', () => ({ default: () => <div data-testid="dither" /> }))
  ```

  (Same pattern used in `ActivityModal.test.tsx:18`.)

- [ ] **Step 5.19: Run `RepoDetail` tests — verify all PASS**

  Run: `npx vitest run src/views/RepoDetail.test.tsx`
  Expected: All tests pass — existing + 5 new (4 in `describe('RepoDetail activities tab')` + 1 adapter test).

- [ ] **Step 5.20: Run full suite**

  Run: `npx vitest run`
  Expected: PASS.

- [ ] **Step 5.21: Commit**

  ```bash
  git add src/components/ActivityEvent.tsx src/views/RepoDetail.tsx src/views/RepoDetail.test.tsx src/styles/globals.css
  git commit -m "feat(repo-detail): add Activities tab; replace Releases tab

  Activities tab is the new default for repos with releases (falls back
  to README when empty, hides from the tab strip then). Renders releases
  as BannerCards via a synthetic ReleaseEvent adapter; clicking a card
  opens the existing panel-based ActivityModal stacked from the clicked
  release downward, with the Learn-this-version action wired through to
  ReleaseModalContent's new install button. Drops the inline
  expandedReleases state — the full body and assets list now live in
  the modal."
  ```

---

## Task 6: Cleanup pass and final verification

**Files:**
- Modify: `src/views/RepoDetail.tsx` (remove unused imports if any)

After Tasks 2-5, some imports may have become unused (`FileDown` if assets moved to the modal; `sanitiseRef` if no longer referenced anywhere in `RepoDetail.tsx`).

- [ ] **Step 6.1: Check for unused imports in `RepoDetail.tsx`**

  Run:
  ```bash
  grep -n "FileDown\|sanitiseRef" src/views/RepoDetail.tsx
  ```

  If `FileDown` only appears in the import line (no usage), remove it.
  If `sanitiseRef` only appears in the import line (no usage), remove it.

- [ ] **Step 6.2: Remove unused imports if any**

  Update the relevant import lines.

- [ ] **Step 6.3: TypeScript check**

  Run: `npx tsc --noEmit`
  Expected: zero errors. (This catches any stray references or stale types from the refactor.)

- [ ] **Step 6.4: Run full test suite (final)**

  Run: `npm test`
  Expected: All tests pass. Capture and post the summary line ("Test Files X passed", "Tests Y passed").

- [ ] **Step 6.5: Commit cleanup if any**

  ```bash
  git add src/views/RepoDetail.tsx
  git commit -m "chore(repo-detail): remove unused imports after refactor"
  ```

  If no cleanup was needed (imports still in use), skip this step — do not create an empty commit.

---

## Done

After Task 6, the work is complete:

- ✅ Activities tab replaces Releases tab; default tab logic falls back to README on empty
- ✅ Learn / Star / Fork / Clone buttons use Phosphor Fill icons
- ✅ README mentions extraction is gone; contributor sections render inline
- ✅ Install action moved into the release modal (preserved Library-feed behaviour)
- ✅ All tests pass via `npm test`
- ✅ Six commits on `main`, each green

User verifies UI changes in the running app. Implementer does not launch the dev server.
