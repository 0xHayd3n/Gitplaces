# Repo Security Backend — Design Spec

**Date:** 2026-05-02  
**Status:** Approved

## Goal

Replace the current coarse Dependabot alert counting in `repoStats.ts` with a dedicated security service that fetches full per-alert detail and caches results in SQLite to avoid re-fetching on every repo view.

## Scope

- **In scope:** richer Dependabot alert data (per-alert fields), SQLite caching with 24h TTL, `critical` severity added to vulnerability breakdown
- **Out of scope:** secret scanning, code scanning findings, license compliance, cross-repo security overview, background scanning

## Current State

`fetchSecurity()` in `electron/services/repoStats.ts`:
- Fetches `/dependabot/alerts?state=open` but discards all per-alert detail, only counts by severity (high/moderate/low — missing `critical`)
- Fetches community profile (security policy) and code scanning status in parallel
- No caching — re-fetches on every `getRepoStats` call
- Returns `RepoStats['security']` with only counts, no alert objects

## Design

### 1. Type changes — `src/types/repoStats.ts`

Add a `SecurityAlert` interface:

```ts
export interface SecurityAlert {
  number: number
  package: string
  ecosystem: string
  manifestPath: string
  severity: 'critical' | 'high' | 'moderate' | 'low'
  cveId: string | null
  ghsaId: string
  summary: string
  fixVersion: string | null
  url: string
}
```

Extend `RepoStats['security']`:

```ts
security: {
  available: boolean
  vulnerabilities: { critical: number; high: number; moderate: number; low: number } | null
  hasSecurityPolicy: boolean | null
  codeScanningEnabled: boolean | null
  alerts: SecurityAlert[] | null   // null when !available
}
```

`vulnerabilities` counts are derived from the `alerts` array — no separate counting call. Adding `critical` to the breakdown is the only breaking change to the existing shape; the sidebar reads `high`/`moderate`/`low` directly and must be updated to handle `critical`.

### 2. DB schema — `electron/db.ts`

Add to the main `db.exec` block in `initSchema` (no phase migration needed — new table):

```sql
CREATE TABLE IF NOT EXISTS repo_security_cache (
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,   -- Unix epoch ms
  data       TEXT NOT NULL,      -- JSON blob: full RepoStats['security'] value
  PRIMARY KEY (owner, name)
)
```

One row per `(owner, name)` pair. `INSERT OR REPLACE` on every cache write.

### 3. New service — `electron/services/repoSecurity.ts`

Single exported function:

```ts
export async function getRepoSecurity(
  db: Database.Database,
  owner: string,
  name: string,
  token: string | null,
): Promise<RepoStats['security']>
```

**Cache check (TTL = 24h):**
1. `SELECT fetched_at, data FROM repo_security_cache WHERE owner=? AND name=?`
2. If row exists and `Date.now() - fetched_at < 86_400_000`: return `JSON.parse(data)`
3. Otherwise: fetch fresh data, write cache, return result

**Fetch logic:**
- Three GitHub API calls run in parallel:
  - Paginated Dependabot alerts: `GET /repos/{owner}/{name}/dependabot/alerts?state=open&per_page=100`
  - Community profile: `GET /repos/{owner}/{name}/community/profile`
  - Code scanning: `GET /repos/{owner}/{name}/code-scanning/alerts?per_page=1`
- Alerts pagination: follow `Link: <url>; rel="next"` header in a loop, accumulating all pages into a flat array (same `Link` header pattern used by contributor count in `repoStats.ts`)
- On 403 from Dependabot endpoint: return `{ available: false, vulnerabilities: null, hasSecurityPolicy: null, codeScanningEnabled: null, alerts: null }` — no cache write (403 may be transient or permission-based)
- On success: derive `vulnerabilities` counts from the accumulated alerts array; map raw GitHub alert objects to `SecurityAlert` shape

**Per-alert field mapping from GitHub API:**

| `SecurityAlert` field | GitHub API path |
|---|---|
| `number` | `alert.number` |
| `package` | `alert.dependency.package.name` |
| `ecosystem` | `alert.dependency.package.ecosystem` |
| `manifestPath` | `alert.dependency.manifest_path` |
| `severity` | `alert.security_vulnerability.severity` |
| `cveId` | `alert.security_advisory.cve_id` |
| `ghsaId` | `alert.security_advisory.ghsa_id` |
| `summary` | `alert.security_advisory.summary` |
| `fixVersion` | `alert.security_vulnerability.first_patched_version?.identifier ?? null` |
| `url` | `alert.html_url` |

**Error handling:**
- Individual fetch failures (non-403) caught per-call; degrade gracefully (e.g., `hasSecurityPolicy: null` if profile fetch fails)
- Network errors on alerts fetch: return `available: false` result, no cache write

### 4. Wire-up — `electron/services/repoStats.ts`

- Remove `fetchSecurity` function entirely
- Add import: `import { getRepoSecurity } from './repoSecurity'`
- In `getRepoStats`, replace `fetchSecurity(base, h)` in the `Promise.all` with `getRepoSecurity(db, owner, name, token)`
- No other changes to `getRepoStats`

## Files Touched

| File | Change |
|---|---|
| `src/types/repoStats.ts` | Add `SecurityAlert` interface; extend `security` type |
| `electron/db.ts` | Add `repo_security_cache` table to `initSchema` |
| `electron/services/repoSecurity.ts` | New file — full service implementation |
| `electron/services/repoStats.ts` | Remove `fetchSecurity`; import + call `getRepoSecurity` |
| `src/components/RepoStatsSidebar.tsx` | Handle new `critical` severity — see exact touch-points below |

### 5. Sidebar touch-points — `src/components/RepoStatsSidebar.tsx`

Four specific locations must be updated to include `critical`:

1. **`computeVerdict` — `highVulns` check (line ~28):** The "Critical issues" verdict currently triggers on `highVulns > 0`. This should also trigger on `criticalVulns > 0`, with the sub-text updated to reflect critical-severity count. Add `const criticalVulns = vulns?.critical ?? 0` alongside `highVulns`.

2. **`computeVerdict` — `totalVulns` (line ~28):** `totalVulns = vulns.high + vulns.moderate + vulns.low` must add `vulns.critical`.

3. **Main body `totalVulns` (line ~73):** Same calculation outside `computeVerdict` — must add `security.vulnerabilities.critical`.

4. **Breakdown display string (line ~195):** `{h}h · {m}m · {l}l` → `{c}c · {h}h · {m}m · {l}l` (or equivalent formatting showing critical count).

## Testing

- Unit tests for `getRepoSecurity` in `electron/services/repoSecurity.test.ts` covering:
  - Cache hit (fresh): returns cached data, no fetch
  - Cache miss / stale: fetches, writes cache, returns fresh data
  - 403 response: returns `available: false`, no cache write
  - Pagination: accumulates alerts across multiple pages
  - Field mapping: GitHub alert shape → `SecurityAlert` shape
- Existing `repoStats.test.ts` tests should continue to pass (no logic change there)

## Notes

- `repo_security_cache.fetched_at` uses `INTEGER` (Unix epoch ms) rather than `TEXT` like other cache tables (`topic_cache`, `search_cache`, etc.). This is intentional — integer comparison for TTL checks is simpler and more correct than string-based timestamp comparison.
- `INSERT OR REPLACE` on cache writes resets `fetched_at` on every write; this is correct and intended — a stale cache row is always fully replaced.
