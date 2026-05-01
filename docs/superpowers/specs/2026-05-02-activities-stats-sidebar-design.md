# Activities Tab — Enriched Stats Sidebar

**Date:** 2026-05-02
**Status:** Approved

## Problem

The Activities tab's right stats sidebar currently shows minimal information. The tab doesn't communicate a repo's intrinsic value — there is no way to understand whether a repo is healthy, actively maintained, trending, or secure without leaving the app.

## Goal

Enrich the stats sidebar with a mix of GitHub API data and local tracking data, organised into five clearly scoped sections that together tell the story of a repo's value and the user's relationship with it.

## Sidebar Sections

### 1. Vitals
A 2×2 stat grid:
- Stars (`stargazers_count`) — from repo object
- Forks (`forks_count`) — from repo object
- Open issues (`open_issues_count`) — from repo object
- Contributors — from `GET /repos/{owner}/{name}/contributors?per_page=1`; parse the `Link: <…>; rel="last"` header to extract the final page number as the total count. If the `Link` header is absent, the array length is the total. If the call fails, show `--`.

### 2. Health
A donut ring showing a 0–100 score plus three named status signals.

**Score formula** — pure function `computeHealthScore(data)`, weighted across three components. Each component scores 0–100; the final score is the weighted sum:

- **Last commit age (40%):** score = `clamp(1 - (daysSinceCommit - 7) / (180 - 7), 0, 1) * 100`. Full score if ≤ 7 days old, zero if ≥ 180 days, linear between.
- **Issue load (40%):** score = `clamp(1 - openIssues / 200, 0, 1) * 100`. Full score if 0 open issues, zero if ≥ 200. Uses `open_issues_count` from the repo object — no additional API call. (Replaces the close-rate metric which requires a separate Search API call.)
- **Release recency (20%):** score = `clamp(1 - (daysSinceRelease - 30) / (365 - 30), 0, 1) * 100`. Full score if ≤ 30 days, zero if ≥ 365 days, linear between. If `lastReleaseDaysAgo` is `null` (no releases), this component contributes **0**.

**Status signals:**
- `Maintenance` — Active (last commit < 30d) / Slow (30–90d) / Stale (> 90d)
- `Issue velocity` — Healthy (openIssues < 50) / Backlogged (50–200) / Critical (> 200)
- `Last release` — displayed as a relative string derived from `lastReleaseDate` (e.g. "12 days ago"). Use the existing relative-time utility already present in the codebase. If no releases, show "No releases".

Data sources: last commit from `GET /repos/{owner}/{name}/commits?per_page=1`, repo object for open issues, `lastReleaseDate` from the existing releases data already fetched in `RepoDetail` (no extra API call).

### 3. Momentum
A bar chart showing commit activity over the last 6 months, with a trend label.

Data source: `GET /repos/{owner}/{name}/stats/commit_activity` — returns 52 weeks of `{ week, total }`. Aggregate the last 26 weeks into 6 monthly buckets. Trend is determined by comparing the mean of the last 3 months to the mean of the prior 3 months: > 10% increase = `'up'`, > 10% decrease = `'down'`, otherwise `'stable'`.

**202 "being computed" handling:** if GitHub returns 202, the service returns `momentum: null`. The hook does **not** retry — it holds the null state until the user re-navigates to the repo. The component shows a static "Stats computing on GitHub…" label in place of the chart.

### 4. Security (stub)
A summary row showing vulnerability count + two status signals. This section's data layer will be replaced when the full security system is built — the component interface stays stable.

**Stub data (all calls inside a single try/catch; any failure sets `available: false`):**
- Vulnerability count + severity breakdown: `GET /repos/{owner}/{name}/dependabot/alerts?state=open` (requires `security_events` scope; if 403, set `available: false`)
- Security policy presence: `GET /repos/{owner}/{name}/community/profile` → `files.security !== null`
- Code scanning enabled: `GET /repos/{owner}/{name}/code-scanning/alerts?per_page=1` — **200 = enabled**, **404 = not enabled**, **403 = scope missing** (sets `codeScanningEnabled: null`)

If the token lacks the required scope, `security.available` is `false` and the section renders a "security data unavailable" state rather than an error.

### 5. Your Engagement
Personal interaction history read entirely from local SQLite — no new DB work needed:
- Starred: `starred_at` from `repos` table
- Forked: `forked_at` from `repos` table
- Skills learned: `SELECT COUNT(*) FROM skills WHERE repo_id = ? AND generated_at IS NOT NULL` + `SELECT COUNT(*) FROM sub_skills WHERE repo_id = ? AND generated_at IS NOT NULL`, summed. This counts distinct skill rows with completed generation — not the same query as `getRepoUserEvents` (which checks existence only).

## Architecture

### New files

**`src/types/repoStats.ts`**
```ts
type HealthStatus = 'active' | 'slow' | 'stale'
type IssueVelocity = 'healthy' | 'backlogged' | 'critical'

interface RepoStats {
  vitals: {
    stars: number
    forks: number
    openIssues: number
    contributors: number | null   // null if contributor call fails
  }
  health: {
    score: number                 // 0–100
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDate: string | null   // ISO date string; null = no releases
    lastReleaseDaysAgo: number | null
  }
  momentum: {
    monthlyCommits: number[]      // length 6, oldest first
    trend: 'up' | 'stable' | 'down'
  } | null                        // null = GitHub returned 202 (computing); service never produces a non-null momentum with empty monthlyCommits
  security: {
    available: boolean
    vulnerabilities: { high: number; moderate: number; low: number } | null
    hasSecurityPolicy: boolean | null
    codeScanningEnabled: boolean | null
  }
  engagement: {
    starredAt: string | null
    forkedAt: string | null
    skillsLearned: number
  }
}
```

**`electron/services/repoStats.ts`**
- `getRepoStats(db, owner, name, token): Promise<RepoStats>`
- Makes 4 GitHub API calls in parallel via `Promise.all`: repo object, last commit, commit_activity, security bundle
- Accepts `lastReleaseDate: string | null` as a parameter (passed in from the existing releases data in `RepoDetail`) to avoid a redundant releases API call
- Calls `computeHealthScore(data)` for the derived score
- Reads engagement data from local DB
- Each API call has its own try/catch — partial failures return null fields rather than throwing

**`computeHealthScore(data)`** — pure function exported from the service, unit-testable in isolation.

**IPC handler** — registered in main process alongside existing `github:getRepoUserEvents`:
- Channel: `github:getRepoStats`
- Signature: `(owner, name, lastReleaseDate) => RepoStats`

**Preload** — adds `getRepoStats(owner: string, name: string, lastReleaseDate: string | null): Promise<RepoStats>` to `window.api.github`. Also update the ambient `window.api` type declaration (check for `src/types/electron.d.ts` or equivalent) so the renderer TypeScript does not error on `Property 'getRepoStats' does not exist`.

**`src/hooks/useRepoStats.ts`**
- Same pattern as `useRepoUserEvents`
- Returns `RepoStats | 'loading' | 'error'`
- Returns `'loading'` immediately (without calling IPC) if `owner` or `name` is `undefined`
- Re-fetches when `owner`, `name`, or `lastReleaseDate` change

**`src/components/RepoStatsSidebar.tsx`** + **`RepoStatsSidebar.css`**
- Single component, five sections
- Replaces current `statsSlot` content in `RepoDetail`
- Accepts `stats: RepoStats | 'loading' | 'error'` prop
- Each section handles its own loading/error degradation (shows `--` for unavailable values rather than hiding the section)
- Momentum bar chart: inline SVG or simple CSS flex bars — no chart library dependency
- Health donut: inline SVG — no chart library dependency

### RepoDetail wiring
- Derive `lastReleaseDate` from the existing `releases` data (already in scope)
- Add `useRepoStats(owner, name, lastReleaseDate)` call alongside existing hooks
- Pass result as `stats` prop to `<RepoStatsSidebar>`
- No changes to existing feed rendering

## Error handling

- GitHub API down / rate-limited: all sections show `--`; sidebar still renders
- Security scope missing: `available: false`; security section shows "not available" state, no error thrown
- Momentum 202: `momentum: null`; chart section shows "Stats computing on GitHub…"; no retry
- `owner` / `name` undefined: hook returns `'loading'`; sidebar shows skeleton
- Engagement section never errors — reads local DB which is always available

## Testing

- **`computeHealthScore`** — unit tests: all-zero input; perfect repo (0 open issues, commit today, release today); no releases (score component = 0); commit > 180 days ago; openIssues > 200
- **`getRepoStats` service** — mock GitHub responses, assert correct score + field mapping; assert partial failure (one API call throws, others succeed) returns null fields for the failed section but valid data elsewhere
- **`RepoStatsSidebar`** — component tests: loading state; error state; fully-populated state; security-unavailable state; momentum null (computing) state
- **`useRepoStats`** — hook test: mounts, calls IPC, returns data; undefined owner returns 'loading' without calling IPC

## Out of scope

- Full security system (separate brainstorm + spec)
- Contributor list / individual breakdowns
- Click-through actions from sidebar values
- Caching / rate-limit handling beyond existing GitHub client behaviour
- Language breakdown chart (could be added later as a vitals extension)
