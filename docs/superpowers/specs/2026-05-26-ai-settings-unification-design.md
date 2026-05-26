# AI Settings Unification — Design

**Date:** 2026-05-26
**Status:** Draft, awaiting user approval
**Scope:** Heavy path — UI refactor across multiple sections of `src/views/Settings.tsx`, sidebar nav update. No IPC, storage, or LLM-adapter changes.

## Context

Settings today exposes AI-related configuration across three sidebar entries that overlap and confuse:

- **Providers** — API keys (Anthropic, OpenAI, Gemini, OpenAI-compatible local) + a placeholder OpenCode card that just links to another tab + a "Defaults" sub-section for routing internal features.
- **Claude Code & OpenCode** — Git Suite acting as an MCP server for Claude Code CLI (reverse direction) + a duplicate OpenCode install/login section.
- **Connectors** — GitHub login, Skills Backup, Claude subscription (via Claude Code CLI), and custom MCP connectors.

The taxonomic confusion: the Claude entry in Connectors and the OpenCode entry under Claude Code & OpenCode are both **AI inputs** (Git Suite calls models through CLI subscriptions), but they sit in tabs labeled by tool name. The Claude Code MCP config is the **reverse direction** (external tool calls Git Suite). And OpenCode lives in two tabs at once.

All three tabs are currently rendered inline from a single 1867-line `Settings.tsx`.

## Goals

- **One AI tab** in the Settings sidebar, replacing Providers + Claude Code & OpenCode.
- **Transport-based grouping inside the AI tab** — items grouped by *how Git Suite talks to the model*, not by vendor.
- **Standardized card format** — every AI item shows the same fields in the same order so the user can scan and understand at a glance.
- **Slimmer Connectors tab** — keeps only GitHub + Skills Backup.
- **Pure UI refactor.** No changes to `window.api.*` surfaces, `apiStore`, `electron/llm/`, or any sync service.

## Non-goals

- Adding new providers, new auth flows, or new MCP exposure targets.
- Changing IPC, the storage schema, or LLM adapter code.
- Reordering or restructuring other Settings tabs (Appearance, Language & Speech, Downloads, Projects, Updates).
- Re-wiring the call sites that consume defaults — that work belongs to the multi-provider-agents plan.
- Persisting collapsed/expanded state across sessions. Collapsed state is in-memory only in v1.

## New information architecture

### Settings sidebar

**Before** (8 entries):
Providers · Claude Code & OpenCode · Appearance · Language & Speech · Downloads · Projects · Connectors · Updates

**After** (7 entries):
**AI** · Appearance · Language & Speech · Downloads · Projects · Connectors · Updates

- `CategoryId` (currently in `Settings.tsx:12`) drops `'providers'` and `'claude-opencode'`, adds `'ai'`.
- New `AIIcon` component (brain SVG) replaces `ProvidersIcon` and `DesktopIcon` for the merged entry.
- Default `activeCategory` on mount flips from `'connectors'` (current `Settings.tsx:437`) to `'ai'`.
- Unknown `activeCategory` values (e.g. from stale references) fall through to `'ai'` in the content switch.

### AI tab — five collapsible sections

| # | Section | Default state | Contents |
|---|---|---|---|
| 1 | **API / HTTPS** | expanded | Anthropic, OpenAI, Google Gemini, Local/OpenAI-compatible |
| 2 | **CLI** | expanded | Anthropic's Claude Code, OpenCode |
| 3 | **MCP** | `defaultExpanded={!mcpConfigured}` (so it nags users who haven't configured it, stays out of the way once done) | Git Suite's MCP server config — snippet, auto-configure, test |
| 4 | **Custom MCP** | collapsed (BETA) | User-registered third-party MCP servers (list + add modal) |
| 5 | **Defaults** | collapsed | Chat / Skill gen / Tag extract default model selections |

Section headers are clickable rows with: title (uppercase tracking), item count pill, optional BETA chip, chevron. Click toggles expand/collapse. No summary text on collapsed headers (per user direction — summaries only appear inside the expanded body).

### Connectors tab — slim

After the refactor:
- GitHub login
- Skills Backup
- (Removed: Claude subscription → AI > CLI; Custom MCP → AI > Custom MCP.)

Hint text updates to reflect new scope: "Connect external services Git Suite can read from."

## Card design — standardized format

Every card in the AI tab follows the same shape:

```
┌─────────────────────────────────────────────────────────────┐
│  [icon]  Name          [TRANSPORT CHIP]                     │
│          Short one-line description.                        │
│          [input or status row]                              │
│          ● Status                                  [Action] │
└─────────────────────────────────────────────────────────────┘
```

Fields:

| Field | Notes |
|---|---|
| Icon | `~icons/simple-icons/<provider>` |
| Name | Display label (see card table below) |
| Chip | `API`, `CLI`, or `MCP` — distinct color per transport |
| Description | One short sentence — NEW copy (existing `PROVIDER_INFO_TOOLTIP` strings have model lists for the InfoIcon hover and stay there) |
| Input | Password input for API keys; absent for CLI/MCP cards |
| Status | Color dot + text |
| Action | Test / Connect / Disconnect / Install / Add endpoint — context-dependent |

### Card inventory

| Card | Section | Display name | Icon import | Description copy |
|---|---|---|---|---|
| Anthropic | API | Anthropic | `~icons/simple-icons/anthropic` (existing) | "Claude Opus, Sonnet, Haiku." |
| OpenAI | API | OpenAI | `~icons/simple-icons/openai` (existing) | "GPT-4o, GPT-4.1, o3-mini." |
| Google Gemini | API | Google Gemini | `~icons/simple-icons/googlegemini` (existing) | "Gemini 2.5 Pro, Flash; Gemini 1.5." |
| Local | API | Local / OpenAI-compatible | `~icons/simple-icons/ollama` (existing) | "Ollama, LM Studio, llama.cpp, or any OpenAI-compatible endpoint." |
| Claude Code | CLI | **Anthropic's Claude Code** | `~icons/simple-icons/claude` (NEW — verified present in `@iconify-json/simple-icons`) | "Anthropic's CLI agent. Runs Claude via your Claude.ai subscription." |
| OpenCode | CLI | OpenCode | Inline SVG (existing — angle brackets) | "CLI fork supporting Claude, GPT, Gemini, and local models via one OAuth login." |

The existing `PROVIDER_INFO_TOOLTIP` constant (`Settings.tsx:45-50`) stays in place and continues to drive the InfoIcon hover popovers.

### Chip colors

- **API** — purple, matches existing `--accent`
- **CLI** — green (`#86efac` text on `rgba(74,222,128,0.15)`)
- **MCP** — blue (`#93c5fd` text on `rgba(74,157,209,0.18)`)
- **BETA** — amber, reuses existing BETA chip styling

Resolve concrete values to existing CSS vars where they exist.

### Status dot colors

- Green — Connected / Configured
- Amber — Partially configured / Installing
- Red — Error
- Gray — Not configured / Empty

## Component refactor

`Settings.tsx` is 1867 lines today. Extracting only what this work touches:

```
src/views/Settings.tsx               (shell — sidebar + content router)
src/views/settings/
  AIPanel.tsx                        NEW — the AI tab, owns its sections
  ConnectorsPanel.tsx                NEW — slim GitHub + Skills Backup
  shared/
    SectionBlock.tsx                 NEW — collapsible section wrapper
    ProviderCard.tsx                 NEW — standardized card layout
    AIIcon.tsx                       NEW — sidebar brain icon
```

Appearance / Language / Downloads / Projects / Updates stay inline in `Settings.tsx` — not touched by this work, no reason to disturb them. (A follow-up cleanup can extract them later.)

### SectionBlock contract

```ts
type SectionBlockProps = {
  title: string;          // "API / HTTPS"
  count?: number;         // shown as a pill next to title
  badge?: 'BETA';
  defaultExpanded?: boolean;
  children: ReactNode;    // body, only rendered when expanded
};
```

Local `useState` for expanded state. No persistence. Body is conditionally rendered (not just visually hidden) — keeps the DOM light when collapsed and matches React's natural unmount semantics if a section has heavy children.

### ProviderCard contract

```ts
type ProviderCardProps = {
  icon: ReactNode;
  name: string;
  chip: 'API' | 'CLI' | 'MCP';
  description: string;
  status?: { tone: 'green' | 'amber' | 'red' | 'gray'; text: string };
  children?: ReactNode;   // for inputs (API-key field) or inline progress logs
  actions?: ReactNode;    // right-aligned buttons
};
```

Renders the layout shown above. Children slot under the description for API-key inputs; actions slot to the right for buttons.

### State migration

State currently in the `Settings` function component moves to the panel that owns it:

- Provider configs, OpenAI-compatible endpoints, defaults, test status → `AIPanel`.
- MCP status, snippet, copy/test state → `AIPanel` (MCP section).
- OpenCode install/login state → `AIPanel` (CLI section).
- Claude Code install/login state → `AIPanel` (CLI section).
- GitHub auth, Skills Backup sync status, custom-connector state → `ConnectorsPanel` (custom-connector state is removed — those rows move into AI > Custom MCP).
- Appearance / language / downloads / projects / updates state stays where it is.

The shell `Settings.tsx` becomes: sidebar + a switch over `activeCategory` that renders `<AIPanel />`, `<ConnectorsPanel />`, or one of the existing inline renderers.

### MCP section content

Lifts from the current `renderClaudeOpenCode` "Claude Code" group (`Settings.tsx:1455-1510`) into the MCP `SectionBlock`:
- Status row (configured / not configured + dot)
- Config file path
- Auto-configure button + ephemeral status message
- Manual configuration snippet + copy button
- Test connection row

Handlers (`handleAutoConfigure`, `handleCopy`, `handleTestConnection`, `loadMcpStatus`) move alongside.

### CLI section content

**Anthropic's Claude Code** card replaces the "Claude" connector row currently at `Settings.tsx:1193-1240` plus its inline setup/login progress log. Uses existing handlers: `handleSetup`, `handleLogin`, `handleClaudeDisconnect`. Progress log renders below the card when active.

**OpenCode** card replaces the OpenCode link card at `Settings.tsx:1002-1031` and the OpenCode group at `Settings.tsx:1512-1568`. Uses existing handlers: `handleOpencodeSetup`, `handleOpencodeLogin`, `handleOpencodeLogout`. Progress log renders below the card when active.

### Custom MCP section content

Lifts the custom-connector list and add-modal from `Settings.tsx:1293-1401` into the Custom MCP `SectionBlock`. Handlers (`testConnector`, `handleAddConnector`, `handleRemoveConnector`, `resetAddForm`) move alongside. The "+ Add custom connector" button becomes a row inside the section body; the add modal stays as-is.

### Defaults section content

The existing `DefaultsSection` component (already factored out at `Settings.tsx:237-433`) becomes the body of the Defaults `SectionBlock`. No behavioral change.

## CSS

New rules live in `src/styles/globals.css` (where all settings styles already sit — there is no separate `Settings.css`). Existing CSS variables available for reuse:
- Accent palette: `--accent` (`#6d28d9`), `--accent-soft`, `--accent-border`, `--accent-text` (`#a78bfa`), `--accent-light`, `--accent-hover`
- Background palette: `--bg`, `--bg2`, `--bg3`, `--bg4`
- Type scale: `--text-xs` through `--text-xl`

Existing utility classes to reuse: `.settings-group`, `.settings-group-title`, `.settings-group-body`, `.settings-group-row`, `.connector-row`, `.connector-icon`, `.connector-name`, `.connector-desc`, `.connector-actions`, `.connector-badge`, `.settings-btn`, `.settings-input`, `.status-dot`.

Add new classes only for what's genuinely new: the section header + chevron, the transport chips. Avoid inline styles for anything repeated more than once.

For chip colors: use `--accent-soft` / `--accent-text` for the API chip (matches existing accent system); for CLI and MCP define two new vars (e.g. `--chip-cli-bg`, `--chip-cli-text`, `--chip-mcp-bg`, `--chip-mcp-text`) in the existing `:root` palette block.

## Migration / behavioral notes

- The sidebar removes two entries and adds one. No data migration needed.
- `useEffect` at `Settings.tsx:506-530` that loads provider configs gated by `activeCategory === 'providers'` moves into `AIPanel` and triggers on mount.
- Switching away from AI and back re-mounts `AIPanel`, which re-fetches provider configs. Matches existing behavior (current code re-fetches on `activeCategory` change).
- `Settings.test.tsx` needs updates: references to old category IDs (`providers`, `claude-opencode`) need to change, and at least one new test should cover sidebar IA.

## Testing

Vitest + Testing Library, following the existing `Settings.test.tsx` style:

1. Sidebar renders the "AI" entry; does NOT render "Providers" or "Claude Code & OpenCode" entries.
2. Default active category on mount is "AI".
3. Clicking "AI" renders `AIPanel` with five section headers in the expected order.
4. Default-expanded sections (API, CLI) render their cards on mount.
5. Default-collapsed sections (MCP — when configured —, Custom MCP, Defaults) do NOT render their bodies until clicked.
6. Clicking a collapsed section header expands it; clicking again collapses it.
7. The Connectors tab renders GitHub + Skills Backup; does NOT render the Claude subscription card or Custom MCP rows.
8. At least one card-level interaction smoke test per section (e.g. clicking "Test" on Anthropic fires `window.api.llm.testConnection`).

## Risks

- **Test churn.** `Settings.test.tsx` (and possibly the worktree copies) need updates for the new IA. Estimate: moderate but contained.
- **State re-fetch on tab switch.** Re-mounting `AIPanel` means refetching provider configs each time the user revisits the AI tab. Matches current behavior; not a regression but worth noting.
- **Code locality regression.** Splitting Settings.tsx into multiple files makes individual files smaller but adds cross-file navigation. Mitigated by keeping shared components in `settings/shared/` adjacent to their consumers.
- **Custom MCP visibility change.** Users who previously found custom connectors under "Connectors" now find them under AI > Custom MCP. Section default-collapsed means existing users with no custom connectors won't notice; users with connectors should still see the right count badge.

## Decisions log

| Decision | Outcome |
|---|---|
| Scope of AI tab | Includes MCP exposure + Custom MCP. Excludes GitHub + Skills Backup. |
| Card format | Icon · name · transport chip · description · status · action (Variant B). |
| Section layout | Collapsible sections (Variant C); no sub-tabs, no flat scroll. |
| Label for MCP exposure | "MCP" (short, no qualifier). |
| Sidebar icon for AI | Brain icon. |
| Defaults summary visibility | Hidden when collapsed; only visible inside expanded body. |
| Claude Code card naming | "Anthropic's Claude Code". |
| Claude Code card icon | `~icons/simple-icons/claude` (confirmed present). |
| Extract other panels? | No — only AIPanel + ConnectorsPanel + shared components. |
| Persist collapsed state? | No (v1). In-memory only. |
