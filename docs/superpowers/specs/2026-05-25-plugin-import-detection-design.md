# Plugin Import — Repo-Level Agent & Slash-Command Detection

**Date:** 2026-05-25
**Status:** Design — ready for plan

## Summary

Extend Git-Suite's import pipeline so it detects **sub-agents** (`agents/*.md`) and **slash commands** (`commands/*.md`) inside a plugin or repo, alongside today's skill detection. Replace the skill-shaped `ParsedSkill` with a discriminated union `ParsedImportTarget` covering all three kinds. Auto-enable the matching sync surface on import (`is_subagent` / `is_slash_command`) so imported items round-trip back to `~/.claude/agents/` and `~/.claude/commands/`. Cover local plugin discovery (including the `~/.claude/plugins/marketplaces/` subtree we currently miss) and the GitHub repo importer.

## Motivation

Real-world Claude Code plugins ship mixed content. The official Anthropic marketplace plugins (e.g. `feature-dev`, `hookify`, `code-modernization`) place sub-agents at `agents/*.md` and slash commands at `commands/*.md` alongside `skills/`. Today, Git-Suite's importer only recognizes `SKILL.md`-rooted directories — every sub-agent and command in those plugins is invisible to the library.

Two concrete gaps drive this:

1. **`~/.claude/plugins/marketplaces/<source>/plugins/<plugin>/` is never scanned.** That's where every official plugin actually lives. `discoverPlugins()` covers only the legacy `~/.claude/plugins/<plugin>/` top level and the `cache/` subtree.
2. **No detection of single-file `.md` agents/commands.** The parser assumes a directory with `SKILL.md` + siblings. Agent and command files are one-file-per-item.

The schema is ready: `origin_plugin`, `origin_path`, `origin_version`, `is_subagent`, `is_slash_command` all already exist (Phase 1 and Phase 2 of the skill-parity work). The missing piece is the importer surface that populates them for non-skill content.

## Non-goals (v1)

- Detecting `hooks/`, `mcp.json`, or other plugin surfaces beyond skills / agents / commands.
- Re-import-on-version-change UX. The `origin_version` column supports it but the user-facing flow is a separate design.
- Plugin-enabled-state detection (knowing whether `/plugin enable <name>` is currently active in Claude Code). Documented as a caveat; not solved.
- Arbitrary-folder import or single-file drag/drop. Out of scope per the brainstorm answers — local cache + GitHub only.
- Headless / CLI import path.

## Architecture

### Type model

Replace `ParsedSkill` with a discriminated union:

```ts
type ImportKind = 'skill' | 'subagent' | 'slashCommand'

interface ParsedImportTargetBase {
  kind: ImportKind
  name: string
  handle: string
  description: string
  body: string
  origin: { plugin: string; pluginVersion: string | null; path: string } | null
  model: ImportedModel
  tools: string[] | null
}

interface ParsedSkill extends ParsedImportTargetBase {
  kind: 'skill'
  files: { filename: string; content: string }[]
  argumentHint: null
}

interface ParsedSubagent extends ParsedImportTargetBase {
  kind: 'subagent'
  files: never[]
  argumentHint: null
  color: string | null   // raw frontmatter color (Anthropic palette name) — used to derive color_start at import time
}

interface ParsedSlashCommand extends ParsedImportTargetBase {
  kind: 'slashCommand'
  files: never[]
  argumentHint: string | null
}

type ParsedImportTarget = ParsedSkill | ParsedSubagent | ParsedSlashCommand
```

### Discovery shape

```ts
interface DiscoveredSubagent {
  name: string
  path: string                      // absolute (local) or repo-relative (github)
  description: string | null
  color: string | null
}

interface DiscoveredSlashCommand {
  name: string                      // derived from filename stem; commands don't carry a `name` field in frontmatter
  path: string
  description: string | null
  argumentHint: string | null
}

interface DiscoveredPlugin {
  id: string
  name: string
  version: string | null
  root: string
  skills: DiscoveredSkill[]
  subagents: DiscoveredSubagent[]
  slashCommands: DiscoveredSlashCommand[]
}
```

`RepoSkillIndex` becomes `RepoPluginIndex` with the same three arrays.

### Module structure

- `electron/services/pluginImportService.ts` — renamed from `skillImportService.ts`. Houses the union types, local discovery, parsers (`parseSkill`, `parseSubagent`, `parseSlashCommand`), and `importTarget`.
- `electron/services/pluginImportFromGithubService.ts` — renamed from `skillImportFromGithubService.ts`. Same scope but GitHub-fetched.
- `electron/services/frontmatterFields.ts` — extracted helpers (`parseModelFrontmatter`, `parseToolsFrontmatter`, `parseArgumentHint`). Imported by all three parsers.
- `electron/ipc/agentHandlers.ts` — updated route names and the auto-sync-on-import behavior in the import handler.
- `src/components/ImportPluginDialog.tsx` — renamed from `ImportSkillDialog.tsx`. Renders mixed-kind plugins.

No schema migration. All columns required for this work already exist.

## Discovery

### Local plugin roots

`pluginDiscoveryRoots()` in `agentHandlers.ts` returns:

```
~/.claude/plugins/                                     (existing)
~/.claude/plugins/cache/<source>/<plugin>/             (existing — version dirs as plugin dirs)
~/.claude/plugins/marketplaces/<source>/plugins/       (NEW — where official plugins live)
<cwd>/.opencode/plugins/                               (existing)
```

The marketplaces root is walked the same way: each `<source>/plugins/` subtree's children are plugin directories.

### Plugin gate

A child directory under any root counts as a plugin if it has at least one of: `skills/`, `agents/`, `commands/`. Today's "must have `skills/`" gate becomes "must have any of the three." Plugins where every present directory is empty (no `SKILL.md`-rooted children, no `*.md` agents, no `*.md` commands) drop out.

### Plugin manifest

`readPluginManifest(pluginDir) → { name, version }`:

1. Read `.claude-plugin/plugin.json` first. If present and parseable, return `{ name: pkg.name ?? dirname, version: pkg.version ?? null }`.
2. Fall back to `package.json` (legacy `superpowers` layout still uses it).
3. Fall back to `{ name: dirname, version: null }`.

### Sub-agent listing

`listSubagentsInPluginDir(agentsDir) → DiscoveredSubagent[]`:

- Read `agentsDir` non-recursively.
- For each `*.md` file, parse frontmatter via `gray-matter` for `{ name, description, color }`.
- `name` falls back to `path.basename(file, '.md')`.
- Files where YAML fails to parse still appear with `description: null` and `color: null` — the import-time parser will surface the real error.

### Slash command listing

`listSlashCommandsInPluginDir(commandsDir) → DiscoveredSlashCommand[]`:

- Same shape as sub-agents.
- `name` always comes from `path.basename(file, '.md')` — commands don't carry a `name` field.
- Pulls `description` and `argument-hint`.

### GitHub repo discovery

`discoverPluginInRepo(owner, name) → RepoPluginIndex`:

- Reuses `getRepo` / `getBranch` / `getTreeBySha` from `electron/github.ts`.
- Looks for three root tree entries: `skills`, `agents`, `commands`. Each gets its own listing pass.
- For agent / command summaries, fetches one blob per file via `getRawFileBytes` and parses frontmatter. Per-file failures are isolated (log + skip) so one bad file doesn't abort the whole index.
- `bare-root` layout (single `SKILL.md` at the repo root) is preserved as a skill-only path.

## Parsers

### `parseSubagent(filePath) → ParsedSubagent`

Frontmatter shape:

```yaml
name: code-architect          # optional — defaults to filename stem
description: ...              # optional — defaults to ''
tools: Glob, Grep, Read       # CSV or YAML list (existing parseToolsFrontmatter)
model: sonnet                 # 'sonnet'|'opus'|'haiku'|'inherit' or full model ID
color: green                  # Anthropic palette name
```

Known keys: `{ name, description, tools, model, color }`. Unknown keys logged via `console.warn` (same pattern as `parseSkill`).

`color` mapping:

```ts
const COLOR_MAP = {
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green:  '#22c55e',
  cyan:   '#06b6d4',
  blue:   '#3b82f6',
  purple: '#a855f7',
  pink:   '#ec4899',
}
```

Mapped hex goes to `color_start` at import time. Unknown color string → `hashHandleToColor(handle)` fallback. Missing color → same fallback. The raw color string is not preserved separately — once mapped to hex it lives where every other agent's color lives.

`handle` = `slugifyName(name)`. `tools`, `model`, `argumentHint: null`, `body` = `parsed.content.trim()`, `files: []`.

### `parseSlashCommand(filePath) → ParsedSlashCommand`

Frontmatter shape:

```yaml
description: ...              # optional — defaults to ''
argument-hint: [arg-name]     # optional — array or string form (existing parseArgumentHint)
```

Known keys: `{ description, argument-hint }`. Unknown keys logged. `name` always = `path.basename(file, '.md')`. `handle` = `slugifyName(name)`. `tools: null`, `model: 'inherit'`, `body` = `parsed.content.trim()`, `files: []`.

### Shared

`parseSkill` is unchanged in behavior — only its return type widens to `ParsedSkill` with the explicit `kind: 'skill'` discriminator. The three parsers all use the same `frontmatterFields.ts` helpers.

## Import & sync

### `importTarget(db, target, opts) → ImportResult`

Replaces `importSkill`. Same conflict resolver (`skip | overwrite | rename`), same transactional shape — agent insert, origin metadata, and (for skills only) sibling files land together or roll back together.

Per-kind branches:

| Behavior | `skill` | `subagent` | `slashCommand` |
|---|---|---|---|
| `is_subagent` set in INSERT | `0` | `1` | `0` |
| `is_slash_command` set in INSERT | `0` | `0` | `1` |
| Sibling files written | yes (from `target.files`) | no | no |
| Color seeding | `hashHandleToColor(handle)` | mapped from `target.color`, fallback `hashHandleToColor` | `hashHandleToColor(handle)` |

`origin_plugin`, `origin_path`, `origin_version`, `origin_imported_at` are written identically for all three kinds via the same UPDATE statement used today.

### Auto-sync in the IPC handler

`importTarget` itself stays pure DB work — no disk I/O. The sync happens in the `agents:import:importTarget` IPC handler, mirroring how `agents:create` already calls `runSyncAndPersist`:

```ts
ipcMain.handle('agents:import:importTarget', async (_, target, opts) => {
  const db = getDb(app.getPath('userData'))
  const result = importTarget(db, target, opts)
  let syncWarning: string | undefined
  if (target.kind !== 'skill' && result.conflictResolved !== 'skipped') {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.agentId) as AgentRow
    const synced = await runSyncAndPersist(row, undefined, /* forceOverwrite */ false)
    syncWarning = synced.syncWarning
  }
  broadcastChanged()
  return syncWarning ? { ...result, syncWarning } : result
})
```

Skill imports retain today's "DB only, no disk" behavior. Sub-agent and command imports get an immediate sync attempt. `forceOverwrite: false` means an existing foreign file at the sync target produces a non-fatal `syncWarning` on the result, leaving the foreign file untouched — same surface today's `agents:create` already uses.

### Caveat: shadowing a currently-enabled plugin

If the user imports a sub-agent from a plugin that's currently enabled via `/plugin` in Claude Code, the auto-sync creates `~/.claude/agents/<handle>.md` that shadows the plugin's own copy. This is the user-requested round-trip behavior — Git-Suite is now managing that agent — but it's worth surfacing in the import dialog UI (one-line subtitle, see UI section). No plugin-enabled-state detection in v1.

### IPC route renames

Internal routes, no compat needed:

| Old | New |
|---|---|
| `agents:import:discoverPlugins` | unchanged (returns richer `DiscoveredPlugin`) |
| `agents:import:readSkillFromDisk` | `agents:import:readTargetFromDisk(path, kind)` |
| `agents:import:importSkill` | `agents:import:importTarget(target, opts)` |
| `agents:import:discoverInRepo` | `agents:import:discoverPluginInRepo` |
| `agents:import:readSkillFromRepo` | `agents:import:readTargetFromRepo(owner, name, branch, commitSha, repoPath, kind)` |

The renderer-side wrapper (`window.api.agents.import.*` in `electron/preload.ts`) is updated alongside.

## UI

`ImportSkillDialog.tsx` → `ImportPluginDialog.tsx`. Both panes (local plugins and GitHub repo URL) render mixed-kind plugins:

- Each plugin's expanded card shows **three grouped sub-lists**: `Skills (N)`, `Sub-agents (N)`, `Slash commands (N)`. Empty groups hide entirely so single-kind plugins look identical to today.
- Each row has a kind badge (icon-only, tooltip on hover): skill = book, sub-agent = robot, slash command = chevron-right.
- Sub-agent rows show a color swatch — same `COLOR_MAP` lookup used at import time so the preview matches the imported agent's `color_start`; unknown values render no swatch. Skills show file count; commands show argument-hint when present.
- Selection state moves from `Set<string>` keyed on `path` to `Set<\`${kind}:${path}\`>` to disambiguate cross-kind path collisions.
- Default selection mirrors today's behavior: expanding a plugin pre-selects everything across all three kinds. Per-group "select all / none" links.
- Import button label: `Import N item${s}` (was `Import N skill${s}`).
- Result summary: `Imported 3 sub-agents, 2 slash commands, 5 skills (1 skipped).`
- One-line subtitle under the dialog header: *"Imported sub-agents sync to `~/.claude/agents/`, slash commands to `~/.claude/commands/`. Skills stay in the library only."* — makes the auto-enable behavior visible without modal nagging.

## Error handling

| Failure | Behavior |
|---|---|
| Plugin manifest unreadable / malformed | Fall back to directory name, log warning. Discovery continues. |
| Single `.md` file with malformed YAML frontmatter | Discovery surface shows it with `description: null`; import-time parser raises and is isolated by the batch-import per-target try/catch. |
| Empty body (frontmatter only, no content) | Imports cleanly with `body: ''`. MCP launcher handles empty bodies already. |
| Unknown frontmatter key | Logged via `console.warn`. Same pattern as `parseSkill`. |
| Unknown `color` value | Falls back to `hashHandleToColor(handle)`. Warning logged. |
| Auto-sync target file exists (`~/.claude/agents/<handle>.md`) | `runSyncAndPersist` returns `syncWarning`; foreign file untouched. UI surfaces in batch results. User can retry via existing `agents:sync:retry` flow with overwrite. |
| GitHub blob fetch fails mid-batch | Per-file try/catch with `console.warn`; the rest of the index completes. Matches today's behavior in `readSkillFromRepo`. |
| Transactional crash mid-import | `db.transaction` rolls back. Agent row, origin metadata, and (for skills) sibling files either all land or none do. |

## Testing

### Unit — parsers (`pluginImportService.test.ts`)

- `parseSubagent` with: full frontmatter, partial, missing, malformed YAML, empty body, unknown keys (warn-and-drop), each known `color` value mapped correctly, unknown `color` → fallback, `tools` as CSV vs YAML list, `model` as short name vs full ID.
- `parseSlashCommand` with: full frontmatter, missing, `argument-hint` as string vs array (round-trip via `parseArgumentHint`), unknown keys.
- `parseSkill` regression — existing tests carry over unchanged with the new union type.

### Unit — discovery

- Fixture plugin trees under a `tmp` dir: skills-only, subagents-only, commands-only, mixed, empty (excluded), all-three-but-empty (excluded).
- Marketplaces root walk: a fixture `marketplaces/<source>/plugins/<plugin>/` is picked up.
- Manifest precedence: `.claude-plugin/plugin.json` wins over `package.json`. Bad JSON falls back to dirname.

### Unit — `importTarget`

- Per kind: correct `is_subagent` / `is_slash_command` flags written; `origin_*` columns populated; sibling files written only for skills; color seeded correctly for sub-agents.
- Conflict-resolver branches (`skip`, `overwrite`, `rename`) covered once per kind.
- Transaction rollback: inject a fault inside the file-write loop and assert the agent row didn't land.

### Integration — IPC handler (`agentHandlers.test.ts`)

- `agents:import:importTarget` for a sub-agent in a temp `~/.claude/` lands the file on disk at the expected path, populates `synced_subagent_at`, broadcasts `agents:changed`.
- Conflict case: pre-create a foreign file at the sync target, import, assert `syncWarning` returned and foreign file unchanged.
- Skill import path: no disk write, no `synced_*_at` change.

### Integration — GitHub discovery

- Mock `getRepo` / `getBranch` / `getTreeBySha` / `getRawFileBytes` with fixture data shaped like `anthropics/feature-dev`. Assert `discoverPluginInRepo` returns mixed kinds with correct paths and frontmatter.
- Bare-root layout (root `SKILL.md`) still works.

### Component — `ImportPluginDialog`

- Render a mock plugin with all three kinds: assert per-group counts, badges, default-select-all, per-group select-all/none links, "Import N items" label, per-kind failure summary text.
- Sync-surface subtitle present.
- Carry over existing `ImportSkillDialog.test.tsx` cases that still apply (URL validation, repo-fetch error states, busy spinners).

## Implementation order (rough)

1. Extract `frontmatterFields.ts` helpers (mechanical).
2. Define `ParsedImportTarget` union and update `parseSkill` return type (no behavior change).
3. Add `parseSubagent` + `parseSlashCommand` and their tests.
4. Add manifest-precedence helper + tests.
5. Extend `pluginDiscoveryRoots` to include the `marketplaces/` subtree.
6. Extend `discoverPlugins` to return `subagents` and `slashCommands` arrays + tests.
7. Extend GitHub discovery (`discoverPluginInRepo`) + tests.
8. Refactor `importSkill` → `importTarget` with kind dispatch + tests.
9. Update IPC handler — route renames + auto-sync branch for non-skill imports + tests.
10. Update preload wrapper (`window.api.agents.import.*`).
11. Refactor `ImportSkillDialog.tsx` → `ImportPluginDialog.tsx` UI + tests.
12. Manual verification: import a real plugin (`feature-dev`) end-to-end; verify sub-agent lands at `~/.claude/agents/code-architect.md` and `is_subagent=1` in DB.

## Open questions

None that block the plan. The plugin-enabled-state caveat is documented and accepted for v1.
