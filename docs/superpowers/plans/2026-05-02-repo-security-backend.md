# Repo Security Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse Dependabot alert counting in `repoStats.ts` with a dedicated `repoSecurity.ts` service that fetches full per-alert detail and caches results in SQLite (24h TTL), eliminating redundant re-fetches on every repo view.

**Architecture:** A new `electron/services/repoSecurity.ts` module exports a single `getRepoSecurity(db, owner, name, token)` function. It checks `repo_security_cache` in SQLite first; on a miss it fires three GitHub API calls in parallel (first alerts page + community profile + code scanning), paginates remaining alert pages sequentially, maps raw API objects to typed `SecurityAlert` values, writes the result to cache, and returns. `repoStats.ts` drops its inline `fetchSecurity` and delegates to this function unchanged.

**Tech Stack:** TypeScript, better-sqlite3 (sync SQLite), vitest, GitHub REST API (Dependabot alerts, community profile, code scanning endpoints)

**Spec:** `docs/superpowers/specs/2026-05-02-repo-security-backend-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/repoStats.ts` | Modify | Add `SecurityAlert` interface; extend `RepoStats['security']` with `alerts` and `critical` |
| `electron/db.ts` | Modify | Add `repo_security_cache` table to `initSchema` |
| `electron/services/repoSecurity.ts` | **Create** | Full `getRepoSecurity` implementation |
| `electron/services/repoSecurity.test.ts` | **Create** | Unit tests: cache hit, 403, field mapping, pagination, stale cache |
| `electron/services/repoStats.ts` | Modify | Remove `fetchSecurity`; import + call `getRepoSecurity` |
| `electron/services/repoStats.test.ts` | Modify | Add cache table to test DB; update alert mock shape; fix `vulnerabilities` assertion |
| `src/components/RepoStatsSidebar.tsx` | Modify | Four touch-points: add `critical` to totalVulns, verdict trigger, and display string |

---

## Task 1: Extend types

**Files:**
- Modify: `src/types/repoStats.ts`

- [ ] **Step 1: Add `SecurityAlert` and extend `RepoStats['security']`**

Replace the entire file content:

```ts
export type HealthStatus = 'active' | 'slow' | 'stale'
export type IssueVelocity = 'healthy' | 'backlogged' | 'critical'

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

export interface RepoStats {
  vitals: {
    stars: number
    forks: number
    openIssues: number
    contributors: number | null
  }
  health: {
    score: number                    // 0–100
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDate: string | null   // ISO date string; null = no releases
    lastReleaseDaysAgo: number | null
  }
  momentum: {
    monthlyCommits: number[]         // length 6, oldest first
    trend: 'up' | 'stable' | 'down'
  } | null                           // null = GitHub returned 202 (computing)
  security: {
    available: boolean
    vulnerabilities: { critical: number; high: number; moderate: number; low: number } | null
    hasSecurityPolicy: boolean | null
    codeScanningEnabled: boolean | null
    alerts: SecurityAlert[] | null   // null when !available
  }
  engagement: {
    starredAt: string | null
    forkedAt: string | null
    skillsLearned: number
  }
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
npx tsc --noEmit
```

Expected: type errors in `RepoStatsSidebar.tsx` (uses old `vulnerabilities` shape without `critical`) and `repoStats.ts` (returns old shape). These are expected — they will be fixed in later tasks. Any other error is unexpected.

- [ ] **Step 3: Commit**

```bash
git add src/types/repoStats.ts
git commit -m "feat(security): add SecurityAlert type and extend RepoStats security field"
```

---

## Task 2: Add DB cache table

**Files:**
- Modify: `electron/db.ts`

- [ ] **Step 1: Add `repo_security_cache` to the main `db.exec` block in `initSchema`**

Find the closing `CREATE UNIQUE INDEX IF NOT EXISTS repos_owner_name` line near the end of the main `db.exec` call. Add the new table before that index. The addition goes inside the existing template literal:

```sql
    CREATE TABLE IF NOT EXISTS repo_security_cache (
      owner      TEXT NOT NULL,
      name       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );
```

> Note: `fetched_at` is `INTEGER` (Unix epoch ms), not `TEXT` like other cache tables. This is intentional — integer comparison for the 24h TTL check is simpler and more correct.

- [ ] **Step 2: Commit**

```bash
git add electron/db.ts
git commit -m "feat(security): add repo_security_cache table to initSchema"
```

---

## Task 3: Write tests for `repoSecurity.ts`

**Files:**
- Create: `electron/services/repoSecurity.test.ts`

Write all tests before implementing. They will all fail with a module-not-found error until Task 4.

- [ ] **Step 1: Create the test file**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getRepoSecurity } from './repoSecurity'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE repo_security_cache (
      owner TEXT NOT NULL, name TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    )
  `)
  return db
}

function okJson(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function makeAlert(severity: string, n = 1): object {
  return {
    number: n,
    html_url: `https://github.com/owner/repo/security/dependabot/${n}`,
    dependency: {
      package: { name: 'lodash', ecosystem: 'npm' },
      manifest_path: 'package.json',
    },
    security_vulnerability: {
      severity,
      first_patched_version: { identifier: '4.17.21' },
    },
    security_advisory: {
      ghsa_id: `GHSA-000${n}`,
      cve_id: `CVE-2021-000${n}`,
      summary: 'Prototype pollution in lodash',
    },
  }
}

describe('getRepoSecurity', () => {
  const mockFetch = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  it('returns cached data without fetching when cache is fresh', async () => {
    const db = createDb()
    const cached = {
      available: true,
      vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 },
      hasSecurityPolicy: true,
      codeScanningEnabled: false,
      alerts: [],
    }
    db.prepare('INSERT INTO repo_security_cache VALUES (?,?,?,?)').run(
      'owner', 'repo', Date.now(), JSON.stringify(cached)
    )

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result).toEqual(cached)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('re-fetches and updates cache when cached data is stale (>24h)', async () => {
    const db = createDb()
    const staleAt = Date.now() - 86_400_001
    db.prepare('INSERT INTO repo_security_cache VALUES (?,?,?,?)').run(
      'owner', 'repo', staleAt, JSON.stringify({ available: true, vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 }, hasSecurityPolicy: null, codeScanningEnabled: null, alerts: [] })
    )

    mockFetch
      .mockResolvedValueOnce(okJson([makeAlert('high', 1)]))
      .mockResolvedValueOnce(okJson({ files: { security: null } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result.available).toBe(true)
    expect(result.vulnerabilities?.high).toBe(1)

    const row = db.prepare(
      'SELECT fetched_at FROM repo_security_cache WHERE owner=? AND name=?'
    ).get('owner', 'repo') as { fetched_at: number }
    expect(row.fetched_at).toBeGreaterThan(staleAt)
  })

  it('returns available:false and does not cache on 403', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(okJson({ files: { security: null } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.available).toBe(false)
    expect(result.alerts).toBeNull()
    const row = db.prepare(
      'SELECT * FROM repo_security_cache WHERE owner=? AND name=?'
    ).get('owner', 'repo')
    expect(row).toBeUndefined()
  })

  it('maps GitHub alert fields to SecurityAlert shape', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([makeAlert('critical', 5)]))
      .mockResolvedValueOnce(okJson({ files: { security: { url: 'https://example.com' } } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.alerts).toHaveLength(1)
    expect(result.alerts![0]).toEqual({
      number: 5,
      package: 'lodash',
      ecosystem: 'npm',
      manifestPath: 'package.json',
      severity: 'critical',
      cveId: 'CVE-2021-0005',
      ghsaId: 'GHSA-0005',
      summary: 'Prototype pollution in lodash',
      fixVersion: '4.17.21',
      url: 'https://github.com/owner/repo/security/dependabot/5',
    })
    expect(result.vulnerabilities).toEqual({ critical: 1, high: 0, moderate: 0, low: 0 })
    expect(result.hasSecurityPolicy).toBe(true)
    expect(result.codeScanningEnabled).toBe(true)
  })

  it('accumulates alerts across paginated responses', async () => {
    const db = createDb()
    const page1 = [makeAlert('high', 1), makeAlert('high', 2)]
    const page2 = [makeAlert('moderate', 3)]

    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Link: '<https://api.github.com/repos/owner/repo/dependabot/alerts?page=2&per_page=100>; rel="next"',
          },
        })
      )
      .mockResolvedValueOnce(okJson({ files: { security: null } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(okJson(page2)) // second alerts page (no Link header = last page)

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.alerts).toHaveLength(3)
    expect(result.vulnerabilities?.high).toBe(2)
    expect(result.vulnerabilities?.moderate).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail with import error**

```bash
npx vitest run electron/services/repoSecurity.test.ts
```

Expected: all 5 tests fail with `Cannot find module './repoSecurity'`

- [ ] **Step 3: Commit test file**

```bash
git add electron/services/repoSecurity.test.ts
git commit -m "test(security): add tests for getRepoSecurity"
```

---

## Task 4: Implement `getRepoSecurity`

**Files:**
- Create: `electron/services/repoSecurity.ts`

- [ ] **Step 1: Create the implementation**

```ts
import type Database from 'better-sqlite3'
import { githubHeaders } from '../github'
import type { RepoStats, SecurityAlert } from '../../src/types/repoStats'

const TTL_MS = 86_400_000 // 24h

interface RawAlert {
  number: number
  html_url: string
  dependency: {
    package: { name: string; ecosystem: string }
    manifest_path: string
  }
  security_vulnerability: {
    severity: string
    first_patched_version: { identifier: string } | null
  }
  security_advisory: {
    ghsa_id: string
    cve_id: string | null
    summary: string
  }
}

function extractNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return m ? m[1] : null
}

function mapAlert(raw: RawAlert): SecurityAlert {
  return {
    number: raw.number,
    package: raw.dependency.package.name,
    ecosystem: raw.dependency.package.ecosystem,
    manifestPath: raw.dependency.manifest_path,
    severity: raw.security_vulnerability.severity as SecurityAlert['severity'],
    cveId: raw.security_advisory.cve_id,
    ghsaId: raw.security_advisory.ghsa_id,
    summary: raw.security_advisory.summary,
    fixVersion: raw.security_vulnerability.first_patched_version?.identifier ?? null,
    url: raw.html_url,
  }
}

const UNAVAILABLE: RepoStats['security'] = {
  available: false,
  vulnerabilities: null,
  hasSecurityPolicy: null,
  codeScanningEnabled: null,
  alerts: null,
}

export async function getRepoSecurity(
  db: Database.Database,
  owner: string,
  name: string,
  token: string | null,
): Promise<RepoStats['security']> {
  const row = db.prepare(
    'SELECT fetched_at, data FROM repo_security_cache WHERE owner=? AND name=?'
  ).get(owner, name) as { fetched_at: number; data: string } | undefined

  if (row && Date.now() - row.fetched_at < TTL_MS) {
    return JSON.parse(row.data)
  }

  const h = githubHeaders(token)
  const base = `https://api.github.com/repos/${owner}/${name}`

  // First alerts page + profile + scan fire in parallel
  let alertsRes: Response | null = null
  let profileRes: Response | null = null
  let scanRes: Response | null = null
  try {
    ;[alertsRes, profileRes, scanRes] = await Promise.all([
      fetch(`${base}/dependabot/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
      fetch(`${base}/community/profile`, { headers: h }).catch(() => null),
      fetch(`${base}/code-scanning/alerts?per_page=1`, { headers: h }).catch(() => null),
    ])
  } catch {
    return UNAVAILABLE
  }

  if (alertsRes?.status === 403) return UNAVAILABLE
  if (!alertsRes?.ok) return UNAVAILABLE

  const rawAlerts: RawAlert[] = await alertsRes.json().catch(() => [])

  // Paginate remaining alert pages sequentially
  let nextUrl = extractNextLink(alertsRes.headers.get('Link'))
  while (nextUrl) {
    try {
      const res = await fetch(nextUrl, { headers: h })
      if (!res.ok) break
      const page: RawAlert[] = await res.json().catch(() => [])
      rawAlerts.push(...page)
      nextUrl = extractNextLink(res.headers.get('Link'))
    } catch {
      break
    }
  }

  const alerts = rawAlerts.map(mapAlert)

  // Parse profile — guard against non-object responses (e.g. [] from the test fixture)
  let profileData: { files?: { security?: unknown } } | null = null
  if (profileRes?.ok) {
    const parsed = await profileRes.json().catch(() => null)
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      profileData = parsed as { files?: { security?: unknown } }
    }
  }

  const result: RepoStats['security'] = {
    available: true,
    vulnerabilities: {
      critical: alerts.filter(a => a.severity === 'critical').length,
      high:     alerts.filter(a => a.severity === 'high').length,
      moderate: alerts.filter(a => a.severity === 'moderate').length,
      low:      alerts.filter(a => a.severity === 'low').length,
    },
    hasSecurityPolicy: profileData?.files?.security !== undefined
      ? profileData.files!.security !== null
      : null,
    codeScanningEnabled: scanRes?.status === 200 ? true : scanRes?.status === 404 ? false : null,
    alerts,
  }

  db.prepare(
    'INSERT OR REPLACE INTO repo_security_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
  ).run(owner, name, Date.now(), JSON.stringify(result))

  return result
}
```

- [ ] **Step 2: Run tests to verify all 5 pass**

```bash
npx vitest run electron/services/repoSecurity.test.ts
```

Expected: 5/5 passing

- [ ] **Step 3: Commit**

```bash
git add electron/services/repoSecurity.ts
git commit -m "feat(security): add getRepoSecurity service with cache and pagination"
```

---

## Task 5: Wire up `repoStats.ts`

**Files:**
- Modify: `electron/services/repoStats.ts`

- [ ] **Step 1: Remove `fetchSecurity` and replace with `getRepoSecurity`**

At the top of the file, add the import:
```ts
import { getRepoSecurity } from './repoSecurity'
```

Delete the entire `fetchSecurity` function (lines ~34–64 — the `async function fetchSecurity(...)` block).

In `getRepoStats`, the `Promise.all` call currently passes `fetchSecurity(base, h)` as the last element. Replace it with:
```ts
getRepoSecurity(db, owner, name, token),
```

The destructured variable is already named `security` — no rename needed.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in `RepoStatsSidebar.tsx` (old `vulnerabilities` shape). `repoStats.ts` itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add electron/services/repoStats.ts
git commit -m "refactor(security): delegate security fetch to getRepoSecurity service"
```

---

## Task 6: Update `repoStats.test.ts`

**Files:**
- Modify: `electron/services/repoStats.test.ts`

The existing tests mock `fetch` in a fixed order. After the refactor, `getRepoSecurity` checks the DB cache first (sync), then fires 3 fetch calls. The mock call order stays the same because better-sqlite3 queries are synchronous, so the security fetches are called in the same relative order as before.

- [ ] **Step 1: Add `repo_security_cache` to `createTestDb`**

Find `createTestDb()`. Do NOT replace the whole function — add the new table to the existing `db.exec` template literal, immediately before the closing backtick:

```ts
    CREATE TABLE repo_security_cache (
      owner TEXT NOT NULL, name TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (owner, name)
    );
```

- [ ] **Step 2: Update `alertsPayload` to the full GitHub alert shape**

Replace the existing `alertsPayload` constant:

```ts
const alertsPayload = [
  {
    number: 1,
    html_url: 'https://github.com/owner/repo/security/dependabot/1',
    dependency: { package: { name: 'lodash', ecosystem: 'npm' }, manifest_path: 'package.json' },
    security_vulnerability: { severity: 'high', first_patched_version: { identifier: '4.17.21' } },
    security_advisory: { ghsa_id: 'GHSA-1234', cve_id: 'CVE-2021-1234', summary: 'Prototype pollution' },
  },
  {
    number: 2,
    html_url: 'https://github.com/owner/repo/security/dependabot/2',
    dependency: { package: { name: 'axios', ecosystem: 'npm' }, manifest_path: 'package.json' },
    security_vulnerability: { severity: 'moderate', first_patched_version: null },
    security_advisory: { ghsa_id: 'GHSA-5678', cve_id: null, summary: 'SSRF vulnerability' },
  },
]
```

- [ ] **Step 3: Update the security assertion in `maps GitHub API responses to RepoStats`**

Find:
```ts
expect(result.security.vulnerabilities).toEqual({ high: 1, moderate: 1, low: 0 })
```

Replace with:
```ts
expect(result.security.vulnerabilities).toEqual({ critical: 0, high: 1, moderate: 1, low: 0 })
expect(result.security.alerts).toHaveLength(2)
```

- [ ] **Step 4: Run `repoStats.test.ts` to verify all tests still pass**

```bash
npx vitest run electron/services/repoStats.test.ts
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add electron/services/repoStats.test.ts
git commit -m "test(security): update repoStats tests for new security shape"
```

---

## Task 7: Fix `critical` severity in `RepoStatsSidebar`

**Files:**
- Modify: `src/components/RepoStatsSidebar.tsx`

Four touch-points, all within the existing file. Read the file first to confirm current line numbers before editing.

- [ ] **Step 1: Fix `computeVerdict` — add `criticalVulns` and update `totalVulns`**

Find the block inside `computeVerdict` that reads:
```ts
const vulns = security.vulnerabilities
const highVulns = vulns?.high ?? 0
const totalVulns = vulns ? vulns.high + vulns.moderate + vulns.low : 0
```

Replace with:
```ts
const vulns = security.vulnerabilities
const criticalVulns = vulns?.critical ?? 0
const highVulns = vulns?.high ?? 0
const totalVulns = vulns ? vulns.critical + vulns.high + vulns.moderate + vulns.low : 0
```

- [ ] **Step 2: Fix `computeVerdict` — include `critical` in the "Critical issues" verdict trigger**

Find:
```ts
if (security.available && highVulns > 0) {
  return {
    label: 'Critical issues',
    color: 'var(--red)',
    sub: `${highVulns} high-severity vulnerabilit${highVulns === 1 ? 'y' : 'ies'}`,
  }
}
```

Replace with:
```ts
if (security.available && (criticalVulns > 0 || highVulns > 0)) {
  const severeCount = criticalVulns + highVulns
  return {
    label: 'Critical issues',
    color: 'var(--red)',
    sub: `${severeCount} high-severity vulnerabilit${severeCount === 1 ? 'y' : 'ies'}`,
  }
}
```

- [ ] **Step 3: Fix main body `totalVulns`**

Find the block near the top of the `RepoStatsSidebar` function body (outside `computeVerdict`):
```ts
const totalVulns = security.vulnerabilities
  ? security.vulnerabilities.high + security.vulnerabilities.moderate + security.vulnerabilities.low
  : 0
```

Replace with:
```ts
const totalVulns = security.vulnerabilities
  ? security.vulnerabilities.critical + security.vulnerabilities.high + security.vulnerabilities.moderate + security.vulnerabilities.low
  : 0
```

- [ ] **Step 4: Fix the breakdown display string**

Find the JSX line:
```tsx
{security.vulnerabilities.high}h · {security.vulnerabilities.moderate}m · {security.vulnerabilities.low}l
```

Replace with:
```tsx
{security.vulnerabilities.critical}c · {security.vulnerabilities.high}h · {security.vulnerabilities.moderate}m · {security.vulnerabilities.low}l
```

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: `RepoStatsSidebar.test.tsx` **will** have failures — every mock `RepoStats` object that includes a `vulnerabilities` field needs `critical: 0` added. There are five such objects in that file. Add `critical: 0` to each `vulnerabilities` literal before re-running. Once patched, all tests should pass.

- [ ] **Step 6: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/components/RepoStatsSidebar.tsx
git commit -m "feat(security): add critical severity to vulnerability display and verdict"
```
