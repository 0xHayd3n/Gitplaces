# Anatomy Phase 1 — Manual Exit Verification

**Prereq:** `npm run vendor` — provisions `vendor/node22/` (copies host
Node ≥22) and builds the `vendor/anatomy` submodule
(`anatomy-validate` → `anatomy-cli`, entry `dist/bin.js`).

> Toolchain note (Windows): the live Git-Suite Electron app locks
> `better_sqlite3.node`, so `npm test`'s `npm rebuild` step fails while the
> app runs. Close the app first, or run vitest directly after a one-time
> `npm rebuild better-sqlite3` (then `npx @electron/rebuild -f -o
> better-sqlite3` to restore the Electron ABI before relaunching the app).

## 1. Unit + integration suites

```
npx vitest run electron/anatomy electron/db.anatomy-migration.test.ts \
  electron/mcp-server.test.ts electron/main.test.ts
```
Expected: all green. With `vendor/` present, the gated spawn smoke
(`runtime.test.ts`) **runs**. The real-repo `e2e.test.ts` additionally
requires `GITHUB_TOKEN` (anonymous multi-clone hits GitHub rate limits and
returns spurious 401s); without a token it skips deterministically. To run
it: `GITHUB_TOKEN=<pat> npx vitest run electron/anatomy/e2e.test.ts` —
expect all 3 cases (committed-anatomy, generated-small, edge-large) green.

## 2. Live app smoke (flag ON)

- `npm run dev`
- In a SQLite client on `gitsuite.db`:
  `INSERT OR REPLACE INTO settings (key,value) VALUES ('anatomyEngineEnabled','true')`
- Install `0xHayd3n/anatomy` (ships a committed `.anatomy`) → confirm
  `skills.anatomy_source='committed'`, files written under
  `userData/anatomy/0xHayd3n/anatomy/`.
- Install a repo with no `.anatomy` (e.g. `sindresorhus/is-odd`) →
  `anatomy_source='generated'` (claude-cli → anthropic-http → Pass-1
  fallback chain; Pass-1 always yields a valid `.anatomy`).
- Install a large repo (e.g. `expressjs/express`) → succeeds, or fails
  with a typed clone/size error (no crash).
- Claude Desktop → `get_skill` for each → returns raw `.anatomy` TOML,
  with an appended `# Lived experience (.anatomy-memory)` section when a
  memory file is present.

## 3. Flag OFF (regression)

- `settings.anatomyEngineEnabled` = `'false'` or unset.
- Install any repo → legacy `.skill.md` produced, `anatomy_source` NULL.
  Confirms zero impact on the existing pipeline.
