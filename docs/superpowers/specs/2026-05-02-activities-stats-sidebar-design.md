# Activities Tab — Enriched Stats Sidebar

**Date:** 2026-05-02
**Status:** Approved

## Problem

The Activities tab's right stats sidebar currently shows minimal information. The tab doesn't communicate a repo's intrinsic value — there is no way to understand whether a repo is healthy, actively maintained, trending, or secure without leaving the app.

## Goal

Enrich the stats sidebar with a mix of GitHub API data and local tracking data, organised into five clearly scoped sections that together tell the story of a repo's value and the user's relationship with it.

## Sidebar Sections

### 1. Vitals
A 2×2 stat grid pulled from the GitHub REST repo object:
- Stars (`stargazers_count`)
- Forks (`forks_count`)
- Open issues (`open_issues_count`)
- Contributors (count from `/repos/{owner}/{name}/contributors?per_page=1` + `Link` header pagination total, or simple count)

### 2. Health
A donut ring showing a 0–100 score plus three named status signals:

**Score formula** — pure function `computeHealthScore(data)`, weighted:
- Last commit age (40%): full points if < 7 days, zero if > 180 days, linear between
- Issue close rate (40%): `closed / (open + closed)` clamped to 0–1, scaled to 0–100
- Days since last release (20%): full points if < 30 days, zero if > 365 days, linear between

**Status signals:**
- `Maintenance` — Active (last commit < 30d) / Slow (30–90d) / Stale (> 90d)
- `Issue velocity` — Healthy (close rate > 60%) / Backlogged (30–60%) / Critical (< 30%)
- `Last release` — date relative string (already available from existing releases data)

Data sources: last commit from `/repos/{owner}/{name}/commits?per_page=1`, issue counts from repo object, last release from existing releases already fetched in `RepoDetail`.

### 3. Momentum
A bar chart showing commit activity over the last 6 months, with a trend label (Trending up / Stable / Declining).

Data source: `/repos/{owner}/{name}/stats/commit_activity` — returns 52 weeks of `{ week, total }`. Aggregate the last 26 weeks into 6 monthly buckets. Trend is determined by comparing the average of the last 3 months to the prior 3 months.

### 4. Security (stub)
A summary row showing vulnerability count + two status signals. This section's data layer will be replaced when the full security system is built — the component interface stays stable.

**Stub data:**
- Vulnerability count + severity breakdown: `/repos/{owner}/{name}/dependabot/alerts?state=open` (requires `security_events` scope; gracefully hidden if scope unavailable)
- `Security policy`: `/repos/{owner}/{name}/community/profile` → `files.security`
- `Code scanning`: presence of `/repos/{owner}/{name}/code-scanning/alerts` (204 = enabled, 404 = not)

If the token lacks the required scope, the section renders a "security data unavailable" state rather than an error.

### 5. Your Engagement
Personal interaction history read entirely from local SQLite — no new DB work needed:
- Starred: `starred_at` from `repos` table
- Forked: `forked_at` from `repos` table
- Skills learned: count from `skills` + `sub_skills` tables (same query as `getRepoUserEvents`)

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
    contributors: number
  }
  health: {
    score: number          // 0–100
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDaysAgo: number | null
  }
  momentum: {
    monthlyCommits: number[]   // length 6, oldest first
    trend: 'up' | 'stable' | 'down'
  }
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
- Makes 4 GitHub API calls (repo object, commits, commit_activity, security) in parallel via `Promise.all`
- Calls `computeHealthScore(data)` for the derived score
- Reads engagement data from local DB (same queries as `getRepoUserEvents`)
- Each API call has its own try/catch — partial failures return null fields rather than throwing

**`computeHealthScore(data)`** — pure function exported from the service, unit-testable in isolation.

**IPC handler** — registered in main process alongside existing `github:getRepoUserEvents`:
- Channel: `github:getRepoStats`
- Handler: calls `getRepoStats(db, owner, name, token)`

**Preload** — adds `getRepoStats(owner: string, name: string): Promise<RepoStats>` to `window.api.github`, matching the shape of existing preload entries.

**`src/hooks/useRepoStats.ts`**
- Same pattern as `useRepoUserEvents`
- Returns `RepoStats | 'loading' | 'error'`
- Re-fetches when `owner`/`name` change

**`src/components/RepoStatsSidebar.tsx`** + **`RepoStatsSidebar.css`**
- Single component, five sections
- Replaces current `statsSlot` content in `RepoDetail`
- Accepts `stats: RepoStats | 'loading' | 'error'` prop
- Each section handles its own loading/error degradation (shows `--` for unavailable values rather than hiding the section)
- The momentum bar chart is rendered with inline SVG or a simple CSS flex bar — no chart library dependency

### RepoDetail wiring
- Add `useRepoStats(owner, name)` call alongside existing hooks
- Pass result as `stats` prop to `<RepoStatsSidebar>`
- No changes to existing feed rendering

## Error handling

- GitHub API down / rate-limited: all sections show `--` values; sidebar still renders
- Security scope missing: security section shows "not available" state, no error thrown
- Partial failure (e.g. commit_activity 202 "being computed"): momentum section shows empty state with "computing…" label on first load
- Engagement section never errors — it reads local DB which is always available

## Testing

- **`computeHealthScore`** — unit tests: all-zero input, perfect repo, no releases, very old last commit
- **`getRepoStats` service** — mock GitHub responses, assert correct score + field mapping
- **`RepoStatsSidebar`** — component tests: loading state, error state, fully-populated state, security-unavailable state
- **`useRepoStats`** — hook test: mounts, calls IPC, returns data

## Out of scope

- Full security system (separate brainstorm + spec)
- Contributor list / individual breakdowns
- Click-through actions from sidebar values
- Caching / rate-limit handling beyond existing GitHub client behaviour
- Language breakdown chart (could be added later as a vitals extension)
