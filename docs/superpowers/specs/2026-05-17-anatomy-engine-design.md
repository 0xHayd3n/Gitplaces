# Anatomy Engine — Design Spec

**Date:** 2026-05-17
**Product:** Git Suite
**Brand:** Eleutex
**Status:** Approved (design); implementation plan pending
**Supersedes (in scope):** the `electron/skill-gen/` pipeline as the skill content source (removed in Phase 3)

---

## 1. Overview

Today Git Suite turns a GitHub repo into a `.skill.md` file via a typed
classify → extractor → template → Haiku pipeline (`electron/skill-gen/`), served
to Claude Desktop through a local MCP server.

This spec replaces that pipeline with the **anatomy** tool
(`0xHayd3n/anatomy`) as the single engine for repo knowledge. Anatomy produces
two TOML artifacts — `.anatomy` (repo identity: stack/form/domain/function
pillars, `[[rules]]`, `[[decisions]]`) and `.anatomy-memory` (append-only
lived-experience log) — explicitly designed to be cited by AI agents, with
commit-pinned staleness detection.

**Core principle:** anatomy's output is served **verbatim**. Git Suite clones a
repo, runs the real anatomy CLI against it (or consumes a committed `.anatomy`
if the repo ships one), stores the raw TOML, and serves it through the existing
MCP tools unchanged in shape. Git Suite never re-summarises or re-buckets
anatomy content — re-projection is exactly the fidelity loss anatomy exists to
prevent (its measured citation reliability is 89% vs a 0% README-summary
baseline).

### Value proposition (unchanged for the user)
Browse GitHub → install a repo → Claude understands it. What changes is the
*fidelity and provenance* of that understanding: maintainer-authored or
anatomy-generated structured knowledge instead of a Haiku README summary.

---

## 2. Decisions Log (with rationale)

These were resolved during brainstorming and are binding for the plan:

| # | Decision | Rationale |
|---|---|---|
| D1 | Anatomy is the **building block**; the `skill-gen` pipeline is fully ripped out (no "augment" / no fallback to legacy extractors). "Build atop it" where anatomy is insufficient. | User intent: anatomy fidelity is the point; legacy summarisation dilutes it. |
| D2 | Drop the `[CORE]/[EXTENDED]/[DEEP]` envelope entirely. Serve anatomy output **as-is**. | Re-bucketing into the legacy envelope is the reprojection anatomy prevents. |
| D3 | Served artifact = **raw `.anatomy` + `.anatomy-memory` TOML, verbatim**. | The TOML *is* anatomy's canonical agent artifact; `render`/`prose` are derived views (a projection). |
| D4 | Produce anatomy for repos lacking one by **shelling out to the real anatomy CLI** against a local clone (not an in-process reimplementation). | Maximum upstream fidelity, reuses anatomy code. |
| D5 | For repos that ship `.anatomy`, **also run anatomy's rule verification** (glob / ast-grep / semgrep). | Surfaces stale/broken rules to the learner. |
| D6 | MCP: **keep Git Suite's single MCP server**; `get_skill`/`search_skills`/`get_collection` return the raw anatomy payload. Do **not** run anatomy's own `anatomy mcp`. | Single server, honours existing tooling (`list_skills`, collections), no Claude Desktop config change. |
| D7 | Depth/budget: replace the `[CORE]`-slice cheap mode with **`anatomy render --budget <tokens>`**, pre-computed at generation time. | Native anatomy mechanism; keeps the read path dependency-free. |
| D8 | Staleness pins to the **`.anatomy` file's commit SHA**, reusing existing update machinery. | Matches anatomy's "did this knowledge drift" model; avoids false staleness on unrelated commits. |
| D9 | Runtime: **bundle a pinned Node ≥22 + vendored `@anatomy/cli`** in the app (Approach A). `--ai --provider claude-cli` default. | Electron 31 ships Node 20; anatomy needs Node ≥22. Desktop app cannot assume a dev toolchain. |
| D10 | Cloning: **`isomorphic-git`** (pure JS, uses existing GitHub token), no system `git` / no bundled git binary. | Anatomy needs a real `.git`; isomorphic-git produces one with no new system prerequisite. |
| D11 | **Phased** delivery (P1 engine+serve, P2 verify+staleness+UI, P3 rip-out+backfill). | De-risks the clone/CLI/runtime integration before deleting the legacy path. |
| D12 | **(Resolves the §13 P3 gate.)** Phase 3 rip-out keeps the **component-library extractor path + the `get_components_skill` sub-skill** as the single retained legacy exception. Anatomy is the spine (the master skill is raw `.anatomy`); the components sub-skill rides alongside it, regenerated independently. D1's "fully ripped out" is hereby qualified to **"rip out `electron/skill-gen/` *except* the component-library extractor + the components sub-skill generation path."** | Anatomy's pillars (`stack/form/domain/function` + rules/decisions) do not model per-component prop/variant detail; that fidelity is high-value and was heavily invested in across Phase-1-era work. One scoped, well-bounded exception beats regressing every component-library skill. |
| D13 | **(Resolves the deferred "assess later".)** The versioned-install path (`main.ts` `if (ref)` → `generateSkillViaLocalCLI`/`generateSkill`, producing `version:<ref>` sub-skills) stays **frozen permanently** — kept exactly as-is, outside the anatomy engine, no migration, no anatomy-at-ref. A second small retained legacy island alongside D12's components path. | Versioned installs need skill-at-an-old-tag; anatomy only clones default-branch HEAD. The feature still works via the legacy path; the cost of anatomy-fying it (ref clone/checkout + CLI-at-commit) is not justified for a low-traffic feature. |

---

## 3. Hard Constraints

- **Node runtime gap:** Git Suite is Electron `^31.0.1` → bundled Node 20.
  `@anatomy/cli` requires **Node ≥ 22**. The Electron main process therefore
  **cannot** run anatomy in-process. Every invocation spawns a bundled Node 22
  child running the vendored CLI.
- **Anatomy needs a git working tree:** anatomy pins reads to a git commit and
  shells out to `git` inside the target dir. A tarball extract is insufficient;
  a real `.git` must exist (produced by `isomorphic-git`).
- **Serve verbatim:** no Git-Suite-side summarisation, truncation-by-relevance,
  or section re-bucketing of anatomy content. Display-layer typesetting (UI
  only) is permitted; the *served* payload is byte-faithful.
- **Readonly MCP binary stays dependency-free:** `git-suite-mcp` runs without
  the app, against a readonly DB. It must not need Node 22 / spawn / a clone at
  read time. All anatomy invocation happens at *generation* time; reads return
  stored strings.
- **No YAML frontmatter exists** in skill files today. Legacy-envelope
  consumers are exactly: `parseSkillDepths` and `parseComponents`
  (`src/utils/skillParse.ts`), and the `## [CORE]` regexes in
  `electron/mcp-server.ts`. These are flag-branched, not "migrated".

---

## 4. Architecture

New subsystem `electron/anatomy/`, parallel to (and in Phase 3 replacing)
`electron/skill-gen/`.

```
GitHub API (metadata, readme, default branch — as today)
        │
        ▼
electron/anatomy/clone.ts      ── isomorphic-git shallow clone ──▶ userData/anatomy-cache/<owner>/<repo>@<sha>/
        │
        ▼
electron/anatomy/runtime.ts    ── spawn bundled Node22 + vendored @anatomy/cli ──▶
        │   anatomy generate --ai --provider claude-cli --repo <dir>
        │   (or: repo ships .anatomy → anatomy validate --require, use committed files)
        ▼
<dir>/.anatomy   +   <dir>/.anatomy-memory      (verbatim)
        │
        ├─▶ stored verbatim (DB + userData/anatomy/<owner>/<repo>/)
        ├─▶ anatomy render --budget 1500  ──▶  stored as anatomy_brief
        └─▶ electron/anatomy/parse.ts (smol-toml) ──▶ typed AnatomyModel  (UI + staleness metadata ONLY)
        │
        ▼
existing persistence: prepareWrite conflict-guard → skills upsert → skillSyncPush
        │
        ▼
existing MCP server (electron/mcp-server.ts) — returns raw payload, no [CORE] parsing
```

### 4.1 Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `electron/anatomy/runtime.ts` | Resolve per-platform bundled Node 22 + vendored CLI entry; `spawnAnatomy(args: string[], cwd: string, env): Promise<{stdout,stderr,code}>` via `execFile` (arg array, **no shell**). | Node `child_process` |
| `electron/anatomy/clone.ts` | `ensureClone(owner,name,ref,token): Promise<{dir,sha}>`; shallow clone into cache; LRU eviction by size budget + age; size-ceiling guard. | `isomorphic-git`, store token |
| `electron/anatomy/parse.ts` | `parseAnatomy(toml): AnatomyModel`, `parseMemory(toml): MemoryEntry[]`. Pure. **Only for UI/staleness metadata — never reshapes served content.** | `smol-toml` |
| `electron/anatomy/index.ts` | `generateViaAnatomy(input): Promise<GenerateResult>` — orchestrates clone → spawn → store; returns the **exact existing `GenerateResult` shape** so persistence is untouched. | the above |
| `electron/anatomy/staleness.ts` | `isAnatomyStale(owner,name,storedCommit): Promise<boolean>` via GitHub commits API. Pure-ish (network). | `github.ts` |

### 4.2 Branch seam

A `settings` row `anatomyEngineEnabled` (default `'false'` in P1/P2, `'true'`
in P3). Exactly one guard at each existing generation call site:

- `electron/main.ts` generation handler (~lines 1400–1576; `pipelineGenerate` /
  `pipelineRoute` / `pipelineGenerateComponents` call sites; skills `INSERT` at
  `main.ts:1519`).
- `electron/services/updateService.ts:99` (`applySkillRegen`,
  `pipelineRoute`).

Guard logic: `anatomyEngineEnabled === 'true'` → `generateViaAnatomy(input)`;
else legacy `pipeline`. `generateViaAnatomy` returns the same
`{ content, tier, repoType, validation, ... }` shape, so `prepareWrite`, the
`skills` upsert, `skillSyncPush`, and the disk write are **unchanged**.

---

## 5. Anatomy Format Reference (consumed, not authored by Git Suite)

`.anatomy` (TOML 1.0, UTF-8):
- Required tables: `[identity]` (fields incl. `stack`, `form`, `domain`,
  `function`), `[generated]` (`fingerprint`, `at`, `commit`, `by`).
- Optional tables: `[operation]`, `[substance]`.
- Array-of-tables: `[[rules]]` (statement + optional `verify` clause:
  glob / ast-grep / semgrep kind), `[[decisions]]` (decision + rationale).

`.anatomy-memory` (TOML 1.0, UTF-8):
- Two-line header: `anatomy_memory_version`, `repo_fingerprint`.
- `[[entries]]` blocks, append-only (entries superseded, never rewritten);
  optional `last_verified_at`, `verified_by`.

Git Suite parses these read-only for UI/staleness. The served payload is the
raw file text.

---

## 6. Runtime & Bundling (D9)

- electron-builder `extraResources`: per-platform Node 22 binary
  (`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`) + a vendored,
  pre-built `@anatomy/cli` (pinned version, committed lockfile or vendored
  `node_modules` for the CLI).
- `runtime.ts` resolves the binary by `process.platform`/`arch` from
  `process.resourcesPath` (packaged) or a dev path (unpackaged).
- Invocation: `execFile(nodeBin, [cliEntry, ...args], { cwd, env })`. Arg array
  only — repo paths and owner/name are untrusted input; **never** shell-interpolated.
- AI provider order: `claude-cli` (local Claude Code — Git Suite already
  depends on `@anthropic-ai/claude-code`; no key) → `anthropic-http` with
  `ANTHROPIC_API_KEY` from electron-store → Pass-1 deterministic (no `--ai`).
- Pinned anatomy CLI version recorded in the spec's companion plan and in
  `package.json`/vendor manifest; upgrades are deliberate, not floating.

---

## 7. Clone Lifecycle (D10)

- Cache root: `app.getPath('userData')/anatomy-cache/<owner>/<repo>@<sha>/`.
- `isomorphic-git` shallow clone (`depth: 1`, default branch) using the stored
  GitHub token for private/rate-limit headroom.
- **Size ceiling:** skip clone and surface a typed error if the repo exceeds a
  configured byte ceiling (default 250 MB; setting key
  `anatomyCloneMaxBytes`). Probed via the GitHub repo `size` field before clone.
- **Eviction:** LRU by total cache size (default budget 2 GB, setting key
  `anatomyCacheBudgetBytes`) + age (default 14 days). Eviction runs on app
  start and after each generation.
- A clone is retained after generation (Phase 2 verify/staleness can re-use
  it); eviction is the only deleter. Ephemeral fallback: if write to cache
  fails, clone to an OS temp dir and delete after generation.

---

## 8. Storage & Persistence

Verbatim, two targets:

- **Disk:** `userData/anatomy/<owner>/<repo>/.anatomy` +
  `.anatomy-memory` (canonical names so `anatomy render` can run against the
  dir at generation time).
- **DB `skills` table:** reuse + idempotent `ALTER TABLE ... ADD COLUMN`
  wrapped in `try/catch` (matching the `electron/db.ts` Phase-3 migration
  style):
  - `content` (existing) = raw `.anatomy` text (primary served payload).
  - `anatomy_memory TEXT` = raw `.anatomy-memory` text (nullable).
  - `anatomy_commit TEXT` = `[generated].commit` (drives staleness, D8).
  - `anatomy_fingerprint TEXT` = `[generated].fingerprint`.
  - `anatomy_source TEXT` = `'committed'` | `'generated'`.
  - `anatomy_brief TEXT` = pre-rendered `anatomy render --budget N` output (D7).
  - Existing `github_sha` is set to `anatomy_commit` (reuses the existing
    sync column rather than adding a parallel one).
- `prepareWrite` (`electron/skill-gen/regeneration.ts`) conflict-guard is
  reused unchanged: deterministic verbatim storage means the generated block is
  stable across regenerations of an unchanged `.anatomy`.

A column-migration test mirrors `electron/db.mcp-migration.test.ts`.

---

## 9. MCP Changes (D6, D7) — single server kept

`electron/mcp-server.ts`, behaviour change only for anatomy-engine rows:

- **`handleGetSkill`** → return `content` (raw `.anatomy`) + if
  `anatomy_memory` present, append a delimiter
  (`\n\n# Lived experience (.anatomy-memory)\n`) and the raw memory TOML.
  Remove the `${repo}.skill.md` filesystem read for anatomy rows (serve from
  DB; the path-traversal guard for legacy rows stays until Phase 3).
- **`handleSearchSkills`** → drop the `## \[CORE\]` slice. Token-AND match over
  the full raw `.anatomy` text; return the repo plus the first matching
  `[[rules]]` / `[[decisions]]` block (or first 300 chars) as the snippet.
- **`handleGetCollection`** → `depth='core'` returns the stored `anatomy_brief`
  per repo; `depth='full'` returns raw `.anatomy` (+ memory). **No anatomy
  invocation in the read path** — `anatomy_brief` is computed once at
  generation via `anatomy render --budget <anatomyBriefBudgetTokens>`
  (default 1500; setting key `anatomyBriefBudgetTokens`). This preserves the
  readonly, app-independent `git-suite-mcp` guarantee.
- **`handleListSkills`** → unchanged (DB metadata). Legacy `sub_skills`
  (components) path remains flag-gated/legacy through P2; resolved in P3
  (§13).
- Tool *names and input schemas are unchanged* — no Claude Desktop config
  change, no new tool.

`handleGetSkill` may run with `db === null` today (degraded mode). Anatomy rows
require DB content, so in degraded mode anatomy `get_skill` returns the
existing "open the app" message rather than a filesystem read.

---

## 10. Staleness (D8) — reuse existing machinery

- For anatomy-engine repos, `electron/services/updateService.ts` `checkRepo`
  swaps the release/`pushed_at` heuristic for:
  `GET /repos/{owner}/{name}/commits?path=.anatomy&sha={branch}&per_page=1`.
  If the latest commit SHA touching `.anatomy` ≠ stored `anatomy_commit` →
  stale.
- Wiring reuses existing columns/flow: set `repos.update_available`, keep
  `update_checked_at`, the existing 24 h `checkAll` poll, `clearUpdateFlag`,
  and the existing "Updates available" UI badge (semantics now: "anatomy
  drifted").
- Post-regeneration confirmation (when a fresh clone exists) uses
  `anatomy render --check` / `anatomy validate --require-fresh` exit code
  (1 = drift) as a secondary signal, not for the poll.
- Memory fingerprint drift: if `.anatomy-memory`'s `repo_fingerprint` ≠
  `.anatomy`'s `fingerprint`, surface a "memory may not match current anatomy"
  notice (UI only; does not set `update_available`).

The `commits?path=` probe needs no clone — it fits the existing cheap polling
model.

---

## 11. UI — Repo Detail → Skill file tab

Flag-branched in the existing Skill file tab; legacy rendering untouched for
legacy rows.

- **Replace `SkillDepthBars`** (driven by `parseSkillDepths`, meaningless for
  anatomy) with anatomy-native indicators:
  - Source badge: `committed` (green) / `generated` (purple).
  - Counts: N rules · N decisions · N memory entries.
  - Freshness chip: fresh / stale (reuses `update_available` state).
  - Fingerprint-match dot (memory vs anatomy).
- **Main pane:** structured-but-faithful view built from `parse.ts` —
  identity pillars as a small table; `[[rules]]` and `[[decisions]]` as
  verbatim lists (typesetting only, **no content rewriting**); a
  "view raw `.anatomy`" toggle showing the TOML in a code block.
- **`.anatomy-memory` panel** below the anatomy view — "Lived experience":
  `[[entries]]` newest-first, verbatim text + kind + date + `last_verified_at`;
  superseded entries dimmed/collapsible (append-only shown honestly).
- `parseComponents` consumers (components sub-view) remain on the legacy path
  through P2 (§13).

---

## 12. Error & Degraded States

| Condition | Behaviour |
|---|---|
| Bundled runtime unresolved / spawn fails | Typed error in the existing skill-gen error UI. Pre-P3: legacy pipeline still available (flag off). P3: defined hard-fail ("anatomy engine unavailable"). |
| Clone fails (network, auth scope) | Typed retryable error; no skill written; existing error surface. |
| Repo exceeds size ceiling | Skip clone; explicit "repo too large for anatomy (N MB > limit)" message. |
| No AI provider (no Claude Code AND no `ANTHROPIC_API_KEY`) | Fall back to anatomy **Pass-1 deterministic** (`generate` without `--ai`). Lower richness, still anatomy's own output, never nothing. |
| Repo ships `.anatomy` but `anatomy validate` fails (malformed/old schema) | Surface validation errors; offer `generate --force` to regenerate; never serve a broken file. |
| `semgrep`-kind rule, no `semgrep` CLI | Rule reported "unverified (semgrep not installed)", not failed. `@ast-grep/napi` **is** bundled (Electron-ABI rebuild like `better-sqlite3`). Glob rules need nothing. |
| `git-suite-mcp` in degraded mode (no DB) | Anatomy `get_skill` returns the existing "open the app" message. |

---

## 13. Phasing & Scope Boundaries

**Phase 1 — Engine + raw serving (de-risks runtime/clone/CLI):**
- Bundle Node 22 + vendored `@anatomy/cli`; `runtime.ts`, `clone.ts`
  (isomorphic-git), `parse.ts`, `index.ts`.
- `generate --ai --provider claude-cli` (Pass-1 fallback); committed-`.anatomy`
  path via `validate --require`.
- Store raw `.anatomy` + `.anatomy-memory` + provenance columns; pre-render
  `anatomy_brief`.
- `handleGetSkill` returns raw payload. Flag default off — legacy pipeline is
  still the live path.
- Exit criterion: end-to-end correct on ≥3 repos (one committed-anatomy, one
  generated, one large/edge) with snapshot tests.

**Phase 2 — Verify + staleness + UI:**
- `anatomy validate --json` + rule verification (glob built-in, ast-grep
  bundled, semgrep graceful-skip).
- SHA-pinned staleness via `commits?path=.anatomy`, reusing
  `update_available`/`github_sha`/`checkAll`.
- Skill-tab anatomy view + `.anatomy-memory` panel + native indicators
  replacing `SkillDepthBars`.
- `search_skills` raw-text search; `get_collection` budget mapping.

**Phase 3 — Rip-out + backfill:**
- Delete `electron/skill-gen/` **except the component-library extractor + the
  components sub-skill generation path** (kept per D12), plus legacy-envelope
  consumers that only served the master skill (`parseSkillDepths`, the `[CORE]`
  regexes). The retained component path keeps whatever `skill-gen` modules it
  transitively needs; everything else (classify/templates/legacy Haiku/the
  non-component extractors) goes.
- Regenerate all installed skills through the anatomy engine (migration job);
  for component libraries, also regenerate the components sub-skill via the
  retained extractor so `get_components_skill` keeps working.
- Flip `anatomyEngineEnabled` default on; remove the flag and the branch
  seam (the component sub-skill path runs unconditionally, alongside anatomy).
- Define final hard-fail states (no legacy master-skill fallback).
- **Components question — RESOLVED (D12):** the component-library extractor +
  `get_components_skill` sub-skill (`sub_skills` table) are the single retained
  "build atop anatomy" exception. The master skill is raw `.anatomy`; the
  components sub-skill is generated independently and rides alongside it. No
  longer a gate — Phase 3 may be planned.

**Out of scope:** running `anatomy mcp` (D6); authoring/committing `.anatomy`
back to repos (Git Suite is a consumer); Electron major upgrade (a separate
future cleanup; deliberately not coupled — D9/C rejected).

---

## 14. Testing Strategy

- **Pure unit:** `parse.ts` (TOML fixtures → typed model, incl. malformed),
  `staleness.ts` compare logic, MCP handler functions (raw-payload return,
  token search over anatomy text) — mirror `electron/mcp-server.test.ts` and
  `electron/services/updateService.ts` test style.
- **Spawn/integration:** `runtime.spawnAnatomy` against a checked-in fixture
  git repo containing a known `.anatomy` (extend `electron/fixtures/`, mirror
  `electron/skill-gen/pipeline.test.ts`). CI without Node 22 skips this suite
  (or CI provisions Node 22); the suite is required locally before P1 exit.
- **Migration:** new `skills` columns idempotent — mirror
  `electron/db.mcp-migration.test.ts`.
- **Branch-seam:** flag on/off routes anatomy vs legacy at both call sites.
- **Determinism:** same `.anatomy` input → byte-identical stored `content`
  (snapshot) — protects `prepareWrite`.

---

## 15. Key Risks

| Risk | Mitigation |
|---|---|
| Node 22 bundle size / packaging per platform | Accepted (Approach A); pinned versions; electron-builder `extraResources` per arch. |
| `isomorphic-git` slow/memory-heavy on large repos | Shallow `depth:1`; size ceiling; ephemeral-temp fallback; measured at P1 exit. |
| anatomy CLI is young (v1.0.0) — schema churn | Pinned CLI version; parser tolerates unknown tables; `validate` errors surfaced not swallowed. |
| `claude-cli` provider unavailable in packaged app context | Provider fallback chain ends at deterministic Pass-1 — always produces a valid `.anatomy`. |
| Components fidelity regression at P3 rip-out | Resolved (D12): the component extractor + `get_components_skill` sub-skill are retained as the single exception; component libraries keep per-prop fidelity. |
| Two big changes coupled | Phasing (D11); Electron upgrade explicitly out of scope. |
