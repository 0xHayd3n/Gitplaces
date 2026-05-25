# Import Skills from a GitHub Repository — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Phase context:** Follow-on to Phase 1 of the skill-parity work (which shipped plugin-skill import from disk). Adds a third entry path to the same `ImportSkillDialog`: paste a GitHub repo URL, fetch its skills, import the selected ones as fully-owned agents. Same destination model as the plugin path — every imported skill becomes an editable agent with sibling files; no read-only mode, no upstream tracking.

---

## Overview

Today the Agents library can import skills from `~/.claude/plugins/` (the "Browse installed plugins" path in `ImportSkillDialog`). This spec adds a parallel path for importing skills directly from any GitHub repository the user can access — public or private, depending on whether their GitHub token grants access. The flow: user pastes `owner/repo` (or any common URL form), clicks Fetch, sees the list of skills in that repo with checkboxes, and clicks Import. Each imported skill produces an agent with full sibling files, just like the disk path.

The two layouts we detect on the remote side: `skills/<name>/SKILL.md` (the Superpowers/Claude-Code convention) and bare-root repos that *are* a single skill (root contains a `SKILL.md`). All other layouts return an empty list with a clear "No skills found" message.

The fetcher runs entirely in the Electron main process and talks to GitHub via the existing helpers in `electron/github.ts` (which authenticate with the user's stored token). The renderer makes two new IPC calls: one to enumerate skills in the repo (cheap, ~5 + N small calls), one per selected skill to fetch its full content (~1 + M calls per skill, where M is the number of sibling files). The existing `agents:import:importSkill` route is reused unchanged for the actual agent creation.

---

## Goals

- A user can paste any common form of a GitHub repo identifier (`owner/repo`, `https://github.com/owner/repo`, `git@github.com:owner/repo.git`, with or without `.git` suffix) and have the dialog parse it.
- The dialog detects skills in either of two layouts: `skills/<name>/SKILL.md` directories at the repo root, OR a single `SKILL.md` at the repo root.
- The user sees the list of detected skills quickly (single round-trip + N small frontmatter peeks) before committing to import.
- Selected skills are imported using the **same `ParsedSkill` → `importSkill` pipeline** as the disk and plugin paths; no parallel code paths for create/overwrite/skip/rename.
- Imported-from-GitHub agents are distinguishable from imported-from-plugin agents via their `origin_plugin` field (formatted as `owner/name` rather than a bare plugin name) and from `origin_path` (in-repo path like `skills/foo`, or `.` for bare-root).
- Failure of one skill in a batch does not abort the rest (same isolation as the plugin path).
- Public repos work without authentication friction; private repos work automatically if the user is signed into GitHub.
- The new section integrates into the existing `ImportSkillDialog` without restructuring the existing plugin browser.

---

## Non-Goals

- **No upstream tracking.** Imported skills are owned snapshots. We do not poll for repo updates or offer "pull latest." `origin_version` records the commit SHA at import time for future reference, nothing more.
- **No branch selection.** Always use the repo's default branch. No URL `#branch` syntax, no separate branch input field. Reduces dialog complexity for v1.
- **No subpath input.** Always look at the repo root. Skills in `monorepo/packages/foo/skills/` are out of scope.
- **No `agents/<name>.md` single-file layout.** Those are Claude Code subagent files with structured frontmatter (model, tools) and belong to Phase 2 of the skill-parity work.
- **No caching.** Each Fetch click re-runs the discovery. Users importing repeatedly from the same repo will hit the same API calls. If this becomes painful, add an in-memory cache scoped to dialog lifetime later.
- **No repo browser / search picker.** Paste-only. We are not building a "browse popular skill repos" UX.
- **No Discover "saved repos" integration.** Surfacing agent-providing repos in Discover automatically is a separate, larger concern.
- **No bulk "import everything from N repos" wizard.** One repo at a time per Fetch.
- **No automatic conflict-resolution dialog.** Conflicts default to `'rename'` (handle gets `-2` suffix) matching the current plugin-path behaviour. The per-skill conflict screen described in the Phase 1 spec is still un-implemented; this spec does not add it.

---

## URL parser

**File:** `src/utils/parseGithubRepoUrl.ts` (renderer-side; pure function, no I/O).

**Signature:**

```ts
export function parseGithubRepoUrl(input: string): { owner: string; name: string } | null
```

**Accepted forms** (case-insensitive on scheme, trimmed of leading/trailing whitespace, trailing `/` and `.git` stripped):

| Input | Result |
|---|---|
| `owner/repo` | `{ owner: 'owner', name: 'repo' }` |
| `https://github.com/owner/repo` | same |
| `https://github.com/owner/repo.git` | same |
| `http://github.com/owner/repo` | same (we accept http even though it redirects — better UX than rejecting) |
| `git@github.com:owner/repo.git` | same |
| `git@github.com:owner/repo` | same |
| Anything else (empty, malformed, non-github host, has more than 2 path segments) | `null` |

**Validation:** `owner` and `name` must each match `/^[A-Za-z0-9._-]+$/` and be 1–100 chars (matches GitHub's accepted range). Reserved-name checking is **not** done; if a user pastes `github.com/foo/bar` and `foo` happens to be invalid, the downstream `getRepo` call will surface the error.

**Not handled:**
- Subpaths (`github.com/owner/repo/tree/main/path`) — strip everything after the second path segment silently. (Result: subpath is ignored; we always look at the repo root.)
- Enterprise GitHub hosts (`github.mycorp.com`) — return `null`. Phase 1 of any kind of GHE support belongs in its own spec.
- SSH URLs without `git@` prefix (`ssh://...`) — return `null`. Rare in practice.

---

## Service: `skillImportFromGithubService`

**File:** `electron/services/skillImportFromGithubService.ts` (main-process; sibling of `skillImportService.ts`, not part of it).

### Shared types (re-used from `skillImportService.ts`)

- `ParsedSkill` — already exists; this service produces values of this type so they plug straight into `importSkill` unchanged.
- `DiscoveredSkill` — already exists; this service produces a slightly richer variant inside `RepoSkillIndex`.

### New types

```ts
export interface RepoSkillIndex {
  owner: string
  name: string                  // repo name
  branch: string                // resolved default branch
  commitSha: string             // the branch's head commit SHA (for origin_version)
  layout: 'skills-dir' | 'bare-root'
  skills: DiscoveredSkill[]     // DiscoveredSkill.path is the in-repo path (e.g., 'skills/foo' or '.')
}
```

### Public functions

```ts
// Step 1: discovery — enumerate the skills in a repo without downloading their bodies.
export async function discoverSkillsInRepo(
  owner: string,
  name: string,
): Promise<RepoSkillIndex>

// Step 2: per-skill fetch — pull the full content (body + sibling files) of one skill.
//
// `commitSha` is captured by the renderer from the discovery step's RepoSkillIndex
// and passed back here. It is used only to populate ParsedSkill.origin.pluginVersion;
// the actual file fetches use `branch` (the GitHub Contents API would accept a SHA
// here too, but using the branch matches how the rest of this codebase calls
// github.ts, and the TOCTOU window between discovery and read is seconds).
export async function readSkillFromRepo(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,            // e.g., 'skills/foo' or '.'
): Promise<ParsedSkill>
```

### `discoverSkillsInRepo` — algorithm

1. `getRepo(token, owner, name)` → if `null`, throw `RepoNotAccessibleError(owner, name)` (the dialog maps this to a user-facing message — see Error Handling). On success, capture `repo.default_branch`.
2. `getBranch(token, owner, name, defaultBranch)` → capture `commitSha` and `rootTreeSha`.
3. `getTreeBySha(token, owner, name, rootTreeSha)` → list of root entries.
4. Look for a tree entry named `skills` with `type === 'tree'`:
   - **If present** (`skills-dir` layout):
     - `getTreeBySha(token, owner, name, skillsTreeSha)` → list of skill subdirs (entries with `type === 'tree'`).
     - For each subdir: `getTreeBySha(token, owner, name, subdirSha)` to enumerate files. Look for a `SKILL.md` blob entry. If missing, skip the subdir (don't list it).
     - For each subdir that has `SKILL.md`: fetch the SKILL.md content (`getRawFileBytes(token, owner, name, branch, '${skills}/${subdir}/SKILL.md')`) and parse the frontmatter with `gray-matter` to extract `name` and `description` for the preview. `fileCount` = number of file entries in the subdir tree (recursing once for nested dirs like `scripts/`).
     - Push to `skills[]`.
   - **Else, look for a `SKILL.md` blob entry at the repo root** (`bare-root` layout):
     - Fetch and parse it the same way.
     - `path: '.'`. Push a single entry to `skills[]`.
   - **Else**: return with `skills: []` and `layout` set to whichever was attempted last (default `'skills-dir'`).
5. Return `RepoSkillIndex`.

**API call budget (typical):** for a `skills/` repo with N skills, `discoverSkillsInRepo` makes:
- 1× `getRepo`
- 1× `getBranch`
- 1× `getTreeBySha` (root)
- 1× `getTreeBySha` (skills/)
- N× `getTreeBySha` (one per skill subdir, to find SKILL.md and count files)
- N× `getRawFileBytes` (one SKILL.md per skill for frontmatter)
- = **3 + 2N**. For Superpowers' 14 skills: ~31 calls. Comfortably under GitHub's 5000/hr authenticated limit; about 1/170 of the budget per discovery.

### `readSkillFromRepo` — algorithm

1. `getTreeBySha` walk under `repoPath` (or root tree if `repoPath === '.'`) to collect every file path under it.
   - For `skills/foo`: fetch the tree for `skills/foo`'s SHA (already known from discovery? No — discovery doesn't pass SHAs forward; re-fetch). One additional `getTreeBySha` per nested directory.
   - For `.` (bare-root): use the root tree; exclude well-known non-skill files (see Ignore patterns).
2. For each file under that path (excluding ignored patterns):
   - `getRawFileBytes(token, owner, name, branch, fullPath)` → decode as UTF-8.
   - On a per-file failure (404, decode error), skip that file with a `console.warn` — don't abort the skill.
3. The file at `${repoPath}/SKILL.md` (or `SKILL.md` for bare-root) is the body. The rest become `files[]` with relative paths inside the skill.
4. Parse SKILL.md with `gray-matter`. Unknown frontmatter keys are dropped with a `console.warn` (same behaviour as `parseSkill`).
5. Sort `files[]` alphabetically by relative path (matches disk-path behaviour).
6. Set `origin = { plugin: '${owner}/${name}', pluginVersion: commitSha.slice(0,7), path: repoPath }`.

**Origin-population responsibility (intentional difference from disk path).** The disk path's `readSkillFromDisk` returns `ParsedSkill` with `origin: null` and the dialog populates `origin` before calling `importSkill`. Here, `readSkillFromRepo` populates `origin` itself because the service already has owner/name/commitSha at hand (no benefit to deferring it to the dialog). The renderer's import loop just forwards the result to `importSkill` unchanged.

**API call budget (typical):** for a skill with M files (including SKILL.md), 1× tree walk per nested directory + M× raw-file fetches. For a 4-file skill: ~5 calls.

### Ignore patterns

Same set used by `parseSkill` in `skillImportService.ts`:

```ts
const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']
```

For bare-root layout, additionally exclude:
- `README.md` (kept as the body via SKILL.md, not duplicated)
- `LICENSE`, `LICENSE.md`, `LICENSE.txt`
- `.gitignore`, `.gitattributes`
- `package.json`, `package-lock.json` (these belong to repo tooling, not the skill)
- `node_modules/` (already in IGNORE_NAMES, restated for clarity)

The rationale for the extra bare-root excludes: in a `skills/foo/` directory, anything alongside SKILL.md is presumably part of the skill. In a bare-root repo, the root is a mixed bag of skill content + repo housekeeping, and we want to filter the housekeeping.

### Error types

```ts
export class RepoNotAccessibleError extends Error {
  constructor(public readonly owner: string, public readonly name: string) {
    super(`Couldn't load ${owner}/${name}`)
  }
}
```

Thrown when `getRepo` returns null. The renderer catches this and shows the user-facing message. We don't try to distinguish "no token" vs "404" vs "private repo without access" — `getRepo` returns null for all three, and the message covers all three.

GitHub fetch failures (network errors, 5xx, 403 rate-limit) propagate as the underlying error. The renderer catches them and shows a generic "fetch failed" message with the error's message string appended.

---

## IPC contract additions

Two new routes under `window.api.agents.import.*`:

```ts
// In electron/preload.ts (and matching ambient types in src/env.d.ts):
import: {
  // ...existing...
  discoverInRepo: (url: string) =>
    Promise<RepoSkillIndex>
  readSkillFromRepo: (
    owner: string, name: string, branch: string, commitSha: string, repoPath: string,
  ) => Promise<ParsedSkill>
}
```

The `discoverInRepo` IPC handler in `electron/ipc/agentHandlers.ts` does the URL parsing using the same `parseGithubRepoUrl` (imported from `src/utils/parseGithubRepoUrl.ts`) before calling the service. If the parser returns null, the handler throws a plain `Error('Not a valid GitHub URL')` — the renderer treats this the same as a local parser-null and shows the inline validation message. Doing the parse in main keeps the IPC contract simple (renderer passes the user's raw input string straight through) while still letting the renderer use the same parser locally for inline validation before clicking Fetch. The service itself (`discoverSkillsInRepo`) takes `(owner, name)` already-parsed; URL parsing is not its responsibility.

`readSkillFromRepo` takes the resolved `owner/name/branch` because the renderer already has them from the discovery response — no need to re-resolve.

The existing `agents:import:importSkill` route is reused unchanged. The renderer's import loop after Fetch is essentially identical to the plugin-path loop:

```ts
for (const skill of selected) {
  try {
    const parsed = await api.import.readSkillFromRepo(
      repoIndex.owner, repoIndex.name, repoIndex.branch, repoIndex.commitSha, skill.path,
    )
    await api.import.importSkill(parsed, { folderId, onConflict: 'rename' })
  } catch (err) {
    failures.push({ name: skill.name, error: err.message })
  }
}
```

---

## UI changes

### `ImportSkillDialog.tsx`

Current structure (one section): `INSTALLED PLUGINS` → plugin list → expanded skill list per plugin.

New structure (two sections, in this order):

```
┌─ Import skill ────────────────────────────────────────────┐
│  INSTALLED PLUGINS                                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ⚡ superpowers   v5.1.0    14 skills                 │  │ (existing — unchanged)
│  │ 📦 anthropic-skills        7 skills                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  FROM GITHUB REPOSITORY                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [owner/repo or https://github.com/...           ] 🔍 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  (after Fetch, replaces the input row with:)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ obra/superpowers  (main @ a1b2c3d)            [×]    │  │ (chip showing what was fetched + clear button)
│  │ ☑ brainstorming     Brainstorm things                │  │
│  │ ☑ writing-plans     Plan things                      │  │
│  │ ☑ executing-plans   Execute plans                    │  │
│  │ ...                                                  │  │
│  │                  [Import 14 skills]                  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Component state additions:**

```ts
const [repoUrl, setRepoUrl] = useState('')
const [repoUrlError, setRepoUrlError] = useState<string | null>(null)
const [repoIndex, setRepoIndex] = useState<RepoSkillIndex | null>(null)
const [repoFetching, setRepoFetching] = useState(false)
const [repoSelected, setRepoSelected] = useState<Set<string>>(new Set())
const [repoImporting, setRepoImporting] = useState(false)
```

**Section behaviour:**

1. URL input + magnifying-glass Fetch button. Fetch is disabled when the URL is empty OR `parseGithubRepoUrl(repoUrl) === null`. Inline validation message ("Not a valid GitHub URL") under the input when non-empty and invalid.
2. On Fetch click:
   - `repoFetching = true`, button shows a spinner.
   - Call `api.agents.import.discoverInRepo(repoUrl)`.
   - On success: store `repoIndex`, pre-check all skills (`repoSelected = new Set(skills.map(s => s.path))`).
   - On `RepoNotAccessibleError`: show "Couldn't load this repo. Check the URL and your GitHub sign-in." in the section (red, not a modal alert).
   - On `Error('Not a valid GitHub URL')` from main (shouldn't happen if client-side validation worked, but possible if the parser is updated and the two get out of sync): treat same as the inline parser message.
   - On any other error: show "Couldn't fetch from this repo: ${err.message}" in the section.
   - On empty-skills success (`skills.length === 0`): show "No skills found in this repo. Looked for `skills/<name>/SKILL.md` and root `SKILL.md`."
   - `repoFetching = false`.
3. Once `repoIndex` is populated, the input row is replaced by a chip showing `${owner}/${name}  (${branch} @ ${commitSha.slice(0,7)})` with a small × button that resets state (clears `repoIndex`, `repoSelected`, restores the input). Below the chip: skill checkboxes (same row component as the plugin-expanded view), then an `[Import N skills]` button.
4. On Import click:
   - `repoImporting = true`.
   - Get or create the destination folder (named `${name}`, matching plugin-path behaviour).
   - For each selected skill: `readSkillFromRepo` → `importSkill`. Collect failures.
   - On batch completion: if failures > 0, show the same alert pattern as the plugin path: `Imported with N failures:\n\n· skillname: errormsg\n...`. Then `onClose()`.
   - `repoImporting = false`.

**Disabled states:**

- The Fetch button is disabled while `repoFetching` OR `repoImporting`.
- The Import button is disabled while `repoImporting` OR `repoSelected.size === 0`.
- The existing plugin-path Import button (in expanded plugin view) is also disabled while `repoImporting` — and vice versa, the repo Import button is disabled while a plugin import is in progress. Prevents concurrent batches creating folder-naming races.

### `AgentDetail.css`

Add ~30 lines of CSS for the new GitHub section, following the existing `.import-skill-*` naming convention:

- `.import-skill-github-input-row` — flex row with input + button
- `.import-skill-github-input` — text input
- `.import-skill-github-fetch-btn` — fetch button (matches `.import-skill-import-btn` visual style)
- `.import-skill-github-error` — red error text
- `.import-skill-github-chip` — the "owner/repo (branch @ sha)" pill
- `.import-skill-github-chip-clear` — the × button on the chip
- `.import-skill-github-skills` — the skill list area (re-uses `.import-skill-skill-row` for individual rows)

No new colour tokens needed; reuse existing `--t1`, `--t2`, `--t3`, `--accent-*`.

---

## Components — modified vs added

### Added

- `src/utils/parseGithubRepoUrl.ts` — URL parser, pure function.
- `src/utils/parseGithubRepoUrl.test.ts` — parser tests (one `describe` block, ~10 cases).
- `electron/services/skillImportFromGithubService.ts` — discoverer + reader.
- `electron/services/skillImportFromGithubService.test.ts` — fixture-driven tests with mocked `electron/github.ts`.

### Modified

- `electron/ipc/agentHandlers.ts` — two new IPC handlers, ~25 lines.
- `electron/preload.ts` — two new entries in `agents.import.*`, ~10 lines.
- `src/env.d.ts` — matching ambient types, ~10 lines.
- `src/components/ImportSkillDialog.tsx` — new section + state, ~150 lines.
- `src/components/ImportSkillDialog.test.tsx` — new tests for the GitHub section, ~80 lines.
- `src/views/AgentDetail.css` — new section styles, ~30 lines.

### Unchanged

- `electron/services/skillImportService.ts` — no edits. The new file imports its `ParsedSkill` and `DiscoveredSkill` types; that's the only coupling.
- `electron/services/agentsService.ts` — no edits. The agent + file persistence is unchanged.
- Database schema — no migrations. `origin_plugin` / `origin_path` / `origin_version` already exist and are populated by the existing `importSkill` from the `ParsedSkill.origin` field.
- `AgentDetail.tsx` — no edits. The origin chip already renders when `agent.origin_plugin` is non-null; an `owner/name` value renders fine.

---

## Error handling — full matrix

| Scenario | Source | User-visible behaviour |
|----------|--------|------------------------|
| Empty URL | renderer state | Fetch button disabled, no error shown |
| URL fails parser | `parseGithubRepoUrl` returns null | Inline red text under input: "Not a valid GitHub URL" |
| URL parses, but `getRepo` returns null (no token / 404 / no access) | `RepoNotAccessibleError` thrown by service | In-section red text: "Couldn't load this repo. Check the URL and your GitHub sign-in." |
| Network failure during discovery | underlying `fetch` error | In-section red text: "Couldn't fetch from this repo: ${err.message}" |
| GitHub rate limit (403 with X-RateLimit headers) | underlying error includes "API rate limit" or 403 | Same as network failure (we surface the error message verbatim — GitHub's message is clear enough) |
| Repo has no `skills/` and no root `SKILL.md` | service returns `skills: []` | In-section neutral text: "No skills found in this repo. Looked for `skills/<name>/SKILL.md` and root `SKILL.md`." |
| Repo has `skills/` but a subdir is missing `SKILL.md` | service silently skips that subdir | Subdir does not appear in the list. No error. (Same behaviour as `discoverPlugins` for skill dirs without SKILL.md.) |
| Per-skill `readSkillFromRepo` fails mid-batch | service throws | Collected into `failures[]`, alert shown at end of batch, other skills proceed. |
| Per-file failure inside `readSkillFromRepo` | individual `getRawFileBytes` fails | `console.warn`, file is skipped, skill still imported with its remaining files. Same forgiving behaviour as `parseSkill`. |
| `importSkill` handle conflict | already handled by `importSkill` | Default `onConflict: 'rename'` produces `<handle>-2`, `-3`, etc. Same as plugin path. |

---

## Test plan

### `parseGithubRepoUrl.test.ts` (renderer-side, ~10 cases)

```ts
describe('parseGithubRepoUrl', () => {
  it.each([
    ['owner/repo',                                  { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo',               { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo.git',           { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo/',              { owner: 'owner', name: 'repo' }],
    ['http://github.com/owner/repo',                { owner: 'owner', name: 'repo' }],
    ['HTTPS://GITHUB.COM/Owner/Repo',               { owner: 'Owner', name: 'Repo' }],  // preserves case in path
    ['git@github.com:owner/repo.git',               { owner: 'owner', name: 'repo' }],
    ['git@github.com:owner/repo',                   { owner: 'owner', name: 'repo' }],
    ['  owner/repo  ',                              { owner: 'owner', name: 'repo' }],  // whitespace trim
    ['github.com/owner/repo/tree/main/path',        { owner: 'owner', name: 'repo' }],  // subpath ignored
  ])('parses %s', (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected)
  })

  it.each([
    [''], ['owner'], ['owner/'], ['/repo'], ['owner/repo/extra/parts/many'],
    ['https://gitlab.com/owner/repo'],   // wrong host
    ['github.mycorp.com/o/r'],            // GHE not supported
    ['owner/repo with space'],            // invalid chars
    ['owner/.repo'],                      // leading dot
    ['../etc/passwd'],                    // path traversal attempt
  ])('rejects %s', (input) => {
    expect(parseGithubRepoUrl(input)).toBeNull()
  })
})
```

### `skillImportFromGithubService.test.ts` (main-side, ~12 cases)

Mocks `electron/github.ts` exports (`getRepo`, `getBranch`, `getTreeBySha`, `getRawFileBytes`) via `vi.mock`. Each test sets up the mocks to return synthetic tree/blob data, then asserts on the service's output.

```ts
describe('discoverSkillsInRepo', () => {
  it('finds skills under skills/ and reports skills-dir layout', async () => { ... })
  it('finds a bare-root SKILL.md and reports bare-root layout', async () => { ... })
  it('returns empty skills[] when no skills/ and no root SKILL.md', async () => { ... })
  it('skips skill subdirs that have no SKILL.md', async () => { ... })
  it('falls back to subdir name when frontmatter name is missing', async () => { ... })
  it('uses repo default_branch from getRepo', async () => { ... })
  it('throws RepoNotAccessibleError when getRepo returns null', async () => { ... })
  it('returns commitSha from getBranch for origin tracking', async () => { ... })
})

describe('readSkillFromRepo', () => {
  it('returns ParsedSkill with body, description, and files for a skills/foo path', async () => { ... })
  it('returns ParsedSkill with origin set to owner/name and commit short SHA', async () => { ... })
  it('skips ignored files (.DS_Store, .git, node_modules)', async () => { ... })
  it('continues with remaining files when one file fetch fails', async () => { ... })
  it('excludes README.md and LICENSE when layout is bare-root', async () => { ... })
})
```

### `ImportSkillDialog.test.tsx` (extension, ~6 new cases)

Reuse the existing test file's `beforeEach` `window.api` mock; extend with `discoverInRepo` and `readSkillFromRepo` mocks.

```ts
describe('ImportSkillDialog — GitHub section', () => {
  it('renders the URL input below the plugin list', async () => { ... })
  it('disables Fetch until the URL parses', async () => { ... })
  it('shows inline error for an unparseable URL', async () => { ... })
  it('calls discoverInRepo on Fetch and shows the skill list', async () => { ... })
  it('shows "No skills found" message when discovery returns empty', async () => { ... })
  it('imports selected skills via readSkillFromRepo + importSkill in sequence', async () => { ... })
  it('isolates per-skill failures and surfaces them in the end-of-batch alert', async () => { ... })
})
```

### Manual smoke test

- Paste `obra/superpowers` (or any other public Superpowers repo), Fetch, verify 14 skills appear in ~2 seconds, deselect a couple, Import, verify the agents land in a new "superpowers" folder.
- Verify the imported agents show the `from obra/superpowers v<sha>` origin chip in the hero (existing `agent-detail-chip--origin` rendering, no new code needed).
- Paste a private repo URL (with GitHub signed in and access granted), verify it works the same.
- Paste a non-existent repo, verify the "Couldn't load this repo" message appears.
- Sign out of GitHub, paste any repo, verify the same message appears.
- Paste a repo with no `skills/` dir and no root SKILL.md (e.g., any random repo), verify the "No skills found" message.

---

## Open items deferred to later

- **Subpath URLs.** `github.com/owner/repo/tree/main/some/path` could specify which directory to look in. Worth adding when monorepo skill imports come up; not v1.
- **`agents/<name>.md` layout** for Claude Code single-file subagents. Belongs to Phase 2.
- **Discover integration.** Surfacing "repos that contain skills" in the Discover view automatically. Larger UX concern, separate spec.
- **Caching.** If users repeatedly Fetch the same URL, an in-memory cache scoped to the dialog session would skip ~30 redundant calls. Add when there's evidence of pain.
- **Recursive tree optimisation.** GitHub's `git/trees/{sha}?recursive=1` returns the full tree in one call. Replacing the N tree-walk calls with one recursive call would cut the per-skill cost from ~5 to ~M+1. Worth doing only if discovery starts feeling slow on large repos; needs a new IPC route (`getTreeRecursive`).
- **Per-skill conflict-resolution UI.** The Phase 1 spec described a per-skill Overwrite/Skip/Rename screen; it was never built. This spec inherits the same `onConflict: 'rename'` default. Adding the conflict UI is its own task.
- **"Pick from disk" entry path.** Listed in the Phase 1 spec mockup, never wired into the dialog. The IPC (`readSkillFromDisk`) exists. Adding the UI is separate from this spec.
- **Update detection.** "This skill was imported from `obra/superpowers@a1b2c3d` — there are newer commits available." Could be implemented later by polling `getBranch` and comparing to `origin_version`. Needs an explicit re-import action; no auto-update.
