# Security System Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the security system to cover secret scanning and quantitative code scanning, separate permission-denied from unavailable states, shorten the cache TTL to 6h, and surface dismissed Dependabot alert counts.

**Architecture:** Types change first (cascading compile errors are expected until tests and service are updated). Service tests are rewritten to the new spec before the service is touched, then the service is implemented to make them pass. UI tests follow the same pattern. All five initial GitHub API fetches run in parallel; all four paginated streams then run concurrently via a second `Promise.all`.

**Tech Stack:** TypeScript, Electron, React, Vitest, better-sqlite3, GitHub REST API

**Spec:** `docs/superpowers/specs/2026-05-02-security-system-improvements-design.md`

---

## File Map

| File | Change type |
|---|---|
| `src/types/repoStats.ts` | Modify — add 3 new interfaces, update `security` shape |
| `electron/services/repoSecurity.ts` | Rewrite — new TTL, 5 fetches, `fetchAllPages` helper, new fields |
| `electron/services/repoSecurity.test.ts` | Rewrite — update all existing mocks (3→5), add 9 new test cases |
| `src/components/RepoStatsSidebar.tsx` | Modify — permission message, dismissed row, code scan counts, secret row, verdict |
| `src/components/RepoStatsSidebar.test.tsx` | Modify — update all fixtures, add 8 new test cases |
| `src/hooks/useRepoStats.test.ts` | Modify — fixture update only (line 29–33) |

---

## Task 1: Update type definitions

**Files:**
- Modify: `src/types/repoStats.ts`

- [ ] **Step 1: Replace the file with the new type definitions**

Replace the entire contents of `src/types/repoStats.ts` with:

```typescript
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

export interface SeverityCounts {
  critical: number; high: number; moderate: number; low: number
}

export interface CodeScanningCounts {
  critical: number; high: number; medium: number; low: number; note: number; warning: number
}

export interface SecretScanningCounts {
  active: number; inactive: number; unknown: number
}

export interface RepoStats {
  vitals: {
    stars: number
    forks: number
    openIssues: number
    contributors: number | null
  }
  health: {
    score: number
    maintenance: HealthStatus
    issueVelocity: IssueVelocity
    lastReleaseDate: string | null
    lastReleaseDaysAgo: number | null
  }
  momentum: {
    monthlyCommits: number[]
    trend: 'up' | 'stable' | 'down'
  } | null
  security: {
    available: boolean
    permissionDenied: boolean
    vulnerabilities: SeverityCounts | null
    dismissedVulnerabilities: SeverityCounts | null
    hasSecurityPolicy: boolean | null
    codeScanning: CodeScanningCounts | false | null
    secretScanning: SecretScanningCounts | null
    alerts: SecurityAlert[] | null
  }
  engagement: {
    starredAt: string | null
    forkedAt: string | null
    skillsLearned: number
  }
}
```

- [ ] **Step 2: Verify TypeScript sees the expected compile errors (not a test run)**

Run:
```bash
cd D:\Coding\Git-Suite && npx tsc --noEmit 2>&1 | head -40
```

Expected: errors in `repoSecurity.ts`, `repoSecurity.test.ts`, `RepoStatsSidebar.tsx`, `RepoStatsSidebar.test.tsx`, and `useRepoStats.test.ts` referencing `codeScanningEnabled`. This confirms the cascade is working. No other errors should appear.

- [ ] **Step 3: Commit**

```bash
git add src/types/repoStats.ts
git commit -m "feat(security): expand security type shape with secret scanning, code scanning counts, and permission-denied fields"
```

---

## Task 2: Fix useRepoStats.test.ts fixture (type-only)

**Files:**
- Modify: `src/hooks/useRepoStats.test.ts` (lines 29–33 only)

- [ ] **Step 1: Update the mockStats security fixture**

Replace the `security` block inside `mockStats` (lines 29–33 of the current file) with:

```typescript
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 2 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: false,
    secretScanning: null,
    alerts: null,
  },
```

- [ ] **Step 2: Verify this file now compiles**

```bash
npx tsc --noEmit 2>&1 | grep useRepoStats
```

Expected: no output (no errors for this file).

- [ ] **Step 3: Run its tests to confirm they still pass**

```bash
npx vitest run src/hooks/useRepoStats.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRepoStats.test.ts
git commit -m "test(security): update useRepoStats fixture to new security type shape"
```

---

## Task 3: Rewrite service tests

**Files:**
- Modify: `electron/services/repoSecurity.test.ts`

All existing tests need: mocks updated from 3 to 5 (add dismissed + secret), fixtures updated to new shape, stale TTL threshold changed from 24h to 6h. Nine new test cases are added.

- [ ] **Step 1: Replace the entire file**

```typescript
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

function makeCodeScanAlert(severity: string): object {
  return { rule: { severity } }
}

function makeSecretAlert(validity: string): object {
  return { validity }
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
      permissionDenied: false,
      vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 },
      dismissedVulnerabilities: null,
      hasSecurityPolicy: true,
      codeScanning: false,
      secretScanning: null,
      alerts: [],
    }
    db.prepare('INSERT INTO repo_security_cache VALUES (?,?,?,?)').run(
      'owner', 'repo', Date.now(), JSON.stringify(cached)
    )

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result).toEqual(cached)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('re-fetches and updates cache when cached data is stale (>6h)', async () => {
    const db = createDb()
    const staleAt = Date.now() - 21_600_001
    db.prepare('INSERT INTO repo_security_cache VALUES (?,?,?,?)').run(
      'owner', 'repo', staleAt,
      JSON.stringify({
        available: true, permissionDenied: false,
        vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
        dismissedVulnerabilities: null, hasSecurityPolicy: null,
        codeScanning: null, secretScanning: null, alerts: [],
      })
    )

    mockFetch
      .mockResolvedValueOnce(okJson([makeAlert('high', 1)]))  // open dependabot
      .mockResolvedValueOnce(okJson([]))                       // dismissed
      .mockResolvedValueOnce(okJson({ files: { security: null } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(mockFetch).toHaveBeenCalledTimes(5)
    expect(result.available).toBe(true)
    expect(result.vulnerabilities?.high).toBe(1)

    const row = db.prepare(
      'SELECT fetched_at FROM repo_security_cache WHERE owner=? AND name=?'
    ).get('owner', 'repo') as { fetched_at: number }
    expect(row.fetched_at).toBeGreaterThan(staleAt)
  })

  it('returns available:false with permissionDenied:true and does not cache on 403', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.available).toBe(false)
    expect(result.permissionDenied).toBe(true)
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
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: { security: { url: 'https://example.com' } } }))
      .mockResolvedValueOnce(okJson([]))  // code scan enabled, 0 alerts
      .mockResolvedValueOnce(new Response('', { status: 404 }))

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
    expect(result.codeScanning).toEqual({ critical: 0, high: 0, medium: 0, low: 0, note: 0, warning: 0 })
    expect(result.permissionDenied).toBe(false)
  })

  it('accumulates open dependabot alerts across paginated responses', async () => {
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
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: { security: null } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(okJson(page2))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.alerts).toHaveLength(3)
    expect(result.vulnerabilities?.high).toBe(2)
    expect(result.vulnerabilities?.moderate).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })

  // ── New test cases ──────────────────────────────────────────────────────────

  it('counts dismissed vulnerabilities by severity', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([makeAlert('high', 10), makeAlert('high', 11), makeAlert('low', 12)]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.dismissedVulnerabilities).toEqual({ critical: 0, high: 2, moderate: 0, low: 1 })
  })

  it('sets codeScanning to false when endpoint returns 404', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.codeScanning).toBe(false)
  })

  it('counts code scanning alerts by rule.severity when endpoint returns 200', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(okJson([
        makeCodeScanAlert('critical'),
        makeCodeScanAlert('high'),
        makeCodeScanAlert('high'),
        makeCodeScanAlert('medium'),
        makeCodeScanAlert('note'),
      ]))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.codeScanning).toEqual({ critical: 1, high: 2, medium: 1, low: 0, note: 1, warning: 0 })
  })

  it('sets codeScanning to null when endpoint returns non-200/non-404', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.codeScanning).toBeNull()
  })

  it('counts secret scanning alerts by validity', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(okJson([
        makeSecretAlert('active'),
        makeSecretAlert('active'),
        makeSecretAlert('inactive'),
        makeSecretAlert('unknown'),
      ]))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.secretScanning).toEqual({ active: 2, inactive: 1, unknown: 1 })
  })

  it('sets secretScanning to null when endpoint returns non-ok', async () => {
    const db = createDb()
    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.secretScanning).toBeNull()
  })

  it('paginates dismissed dependabot alerts', async () => {
    const db = createDb()
    const dismissedP1 = [makeAlert('high', 101), makeAlert('high', 102)]
    const dismissedP2 = [makeAlert('critical', 103)]

    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(new Response(JSON.stringify(dismissedP1), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          Link: '<https://api.github.com/repos/owner/repo/dependabot/alerts?state=dismissed&page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(okJson(dismissedP2))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.dismissedVulnerabilities).toEqual({ critical: 1, high: 2, moderate: 0, low: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })

  it('paginates code scanning alerts', async () => {
    const db = createDb()
    const scanP1 = [makeCodeScanAlert('high'), makeCodeScanAlert('medium')]
    const scanP2 = [makeCodeScanAlert('critical')]

    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response(JSON.stringify(scanP1), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          Link: '<https://api.github.com/repos/owner/repo/code-scanning/alerts?page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(okJson(scanP2))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.codeScanning).toEqual({ critical: 1, high: 1, medium: 1, low: 0, note: 0, warning: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })

  it('paginates secret scanning alerts', async () => {
    const db = createDb()
    const secretP1 = [makeSecretAlert('active'), makeSecretAlert('active')]
    const secretP2 = [makeSecretAlert('inactive')]

    mockFetch
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson([]))
      .mockResolvedValueOnce(okJson({ files: {} }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secretP1), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          Link: '<https://api.github.com/repos/owner/repo/secret-scanning/alerts?page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(okJson(secretP2))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.secretScanning).toEqual({ active: 2, inactive: 1, unknown: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })
})
```

- [ ] **Step 2: Run the tests — expect TypeScript/import errors (service not yet updated)**

```bash
npx vitest run electron/services/repoSecurity.test.ts 2>&1 | tail -20
```

Expected: test failures or compile errors because `getRepoSecurity` still returns the old shape. That is correct — we write tests before the implementation.

- [ ] **Step 3: Commit the tests**

```bash
git add electron/services/repoSecurity.test.ts
git commit -m "test(security): rewrite service tests for expanded security shape and new endpoints"
```

---

## Task 4: Implement the new service

**Files:**
- Modify: `electron/services/repoSecurity.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import type Database from 'better-sqlite3'
import { githubHeaders } from '../github'
import type {
  RepoStats, SecurityAlert, SeverityCounts, CodeScanningCounts, SecretScanningCounts,
} from '../../src/types/repoStats'

const TTL_MS = 21_600_000 // 6h

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

interface RawCodeScanAlert {
  rule: { severity: string }
}

interface RawSecretAlert {
  validity: 'active' | 'inactive' | 'unknown'
}

function extractNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return m ? m[1] : null
}

async function fetchAllPages<T>(firstRes: Response, headers: HeadersInit): Promise<T[]> {
  const items: T[] = await firstRes.json().catch(() => [])
  let nextUrl = extractNextLink(firstRes.headers.get('Link'))
  while (nextUrl) {
    try {
      const res = await fetch(nextUrl, { headers })
      if (!res.ok) break
      const page: T[] = await res.json().catch(() => [])
      items.push(...page)
      nextUrl = extractNextLink(res.headers.get('Link'))
    } catch {
      break
    }
  }
  return items
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

function countBySeverity(alerts: SecurityAlert[]): SeverityCounts {
  return {
    critical: alerts.filter(a => a.severity === 'critical').length,
    high:     alerts.filter(a => a.severity === 'high').length,
    moderate: alerts.filter(a => a.severity === 'moderate').length,
    low:      alerts.filter(a => a.severity === 'low').length,
  }
}

const UNAVAILABLE: RepoStats['security'] = {
  available: false,
  permissionDenied: false,
  vulnerabilities: null,
  dismissedVulnerabilities: null,
  hasSecurityPolicy: null,
  codeScanning: null,
  secretScanning: null,
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

  const [alertsRes, dismissedRes, profileRes, scanRes, secretRes] = await Promise.all([
    fetch(`${base}/dependabot/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
    fetch(`${base}/dependabot/alerts?state=dismissed&per_page=100`, { headers: h }).catch(() => null),
    fetch(`${base}/community/profile`, { headers: h }).catch(() => null),
    fetch(`${base}/code-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
    fetch(`${base}/secret-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
  ])

  if (alertsRes?.status === 403) return { ...UNAVAILABLE, permissionDenied: true }
  if (!alertsRes?.ok) return UNAVAILABLE

  // fetchAllPages is the sole consumer of each first-page response body.
  // Do not call .json() on any of these responses before passing them here.
  const [openRawAlerts, dismissedRawAlerts, scanAlerts, secretAlerts] = await Promise.all([
    fetchAllPages<RawAlert>(alertsRes, h),
    dismissedRes?.ok ? fetchAllPages<RawAlert>(dismissedRes, h) : Promise.resolve([]),
    // 404 also has ok=false, but explicit check makes intent clear
    scanRes?.ok && scanRes.status !== 404
      ? fetchAllPages<RawCodeScanAlert>(scanRes, h)
      : Promise.resolve([]),
    secretRes?.ok ? fetchAllPages<RawSecretAlert>(secretRes, h) : Promise.resolve([]),
  ])

  const alerts = openRawAlerts.map(mapAlert)
  const dismissedMapped = dismissedRawAlerts.map(mapAlert)

  let profileData: { files?: { security?: unknown } } | null = null
  if (profileRes?.ok) {
    const parsed = await profileRes.json().catch(() => null)
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      profileData = parsed as { files?: { security?: unknown } }
    }
  }

  let codeScanning: CodeScanningCounts | false | null = null
  if (scanRes?.status === 404) {
    codeScanning = false
  } else if (scanRes?.ok) {
    codeScanning = {
      critical: scanAlerts.filter(a => a.rule.severity === 'critical').length,
      high:     scanAlerts.filter(a => a.rule.severity === 'high').length,
      medium:   scanAlerts.filter(a => a.rule.severity === 'medium').length,
      low:      scanAlerts.filter(a => a.rule.severity === 'low').length,
      note:     scanAlerts.filter(a => a.rule.severity === 'note').length,
      warning:  scanAlerts.filter(a => a.rule.severity === 'warning').length,
    }
  }

  const secretScanning: SecretScanningCounts | null = secretRes?.ok
    ? {
        active:   secretAlerts.filter(a => a.validity === 'active').length,
        inactive: secretAlerts.filter(a => a.validity === 'inactive').length,
        unknown:  secretAlerts.filter(a => a.validity === 'unknown').length,
      }
    : null

  const result: RepoStats['security'] = {
    available: true,
    permissionDenied: false,
    vulnerabilities: countBySeverity(alerts),
    dismissedVulnerabilities: dismissedRes?.ok ? countBySeverity(dismissedMapped) : null,
    hasSecurityPolicy: profileData?.files?.security !== undefined
      ? profileData.files!.security !== null
      : null,
    codeScanning,
    secretScanning,
    alerts,
  }

  db.prepare(
    'INSERT OR REPLACE INTO repo_security_cache (owner, name, fetched_at, data) VALUES (?,?,?,?)'
  ).run(owner, name, Date.now(), JSON.stringify(result))

  return result
}
```

- [ ] **Step 2: Run the service tests**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL|repoSecurity"
```

Expected: all 14 tests in `repoSecurity.test.ts` pass.

- [ ] **Step 3: Commit**

```bash
git add electron/services/repoSecurity.ts
git commit -m "feat(security): add secret scanning, quantitative code scanning, dismissed counts, 6h TTL"
```

---

## Task 5: Rewrite UI tests

**Files:**
- Modify: `src/components/RepoStatsSidebar.test.tsx`

All existing `security` fixture objects need the new fields. Eight new test cases are added. The `codeScanningEnabled` field is replaced by `codeScanning` throughout.

- [ ] **Step 1: Replace the entire file**

```typescript
// src/components/RepoStatsSidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoStatsSidebar } from './RepoStatsSidebar'
import type { RepoStats } from '../types/repoStats'

const mockStats: RepoStats = {
  vitals: { stars: 100, forks: 10, openIssues: 5, contributors: 89 },
  health: {
    score: 80, maintenance: 'active', issueVelocity: 'backlogged',
    lastReleaseDate: '2026-04-20T00:00:00Z', lastReleaseDaysAgo: 12,
  },
  momentum: { monthlyCommits: [12, 18, 10, 22, 19, 31], trend: 'up' },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 2, moderate: 1, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
  engagement: { starredAt: '2026-01-12T00:00:00Z', forkedAt: '2026-02-03T00:00:00Z', skillsLearned: 2 },
}

const healthyStats: RepoStats = {
  ...mockStats,
  health: { score: 80, maintenance: 'active', issueVelocity: 'healthy', lastReleaseDate: '2026-04-20T00:00:00Z', lastReleaseDaysAgo: 12 },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: true,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
  momentum: { monthlyCommits: [10, 15, 20, 25, 28, 31], trend: 'up' },
}

const criticalStats: RepoStats = {
  ...mockStats,
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 3, moderate: 1, low: 2 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: false,
    codeScanning: false,
    secretScanning: null,
    alerts: null,
  },
}

const staleStats: RepoStats = {
  ...mockStats,
  health: { score: 30, maintenance: 'stale', issueVelocity: 'healthy', lastReleaseDate: null, lastReleaseDaysAgo: null },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: null,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
}

const middlingStats: RepoStats = {
  ...mockStats,
  health: { score: 55, maintenance: 'slow', issueVelocity: 'healthy', lastReleaseDate: null, lastReleaseDaysAgo: null },
  security: {
    available: true,
    permissionDenied: false,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 },
    dismissedVulnerabilities: null,
    hasSecurityPolicy: null,
    codeScanning: null,
    secretScanning: null,
    alerts: null,
  },
}

describe('RepoStatsSidebar', () => {
  it('renders loading skeleton when stats is loading', () => {
    const { container } = render(<RepoStatsSidebar stats="loading" />)
    expect(container.querySelector('.stats-sidebar-loading')).not.toBeNull()
  })

  it('renders error message when stats is error', () => {
    render(<RepoStatsSidebar stats="error" />)
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
  })

  it('renders vitals section labels', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText(/stars/i)).toBeInTheDocument()
    expect(screen.getByText(/forks/i)).toBeInTheDocument()
    expect(screen.getByText(/contributors/i)).toBeInTheDocument()
  })

  it('renders health score', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('renders total vulnerability count when security is available', () => {
    render(<RepoStatsSidebar stats={mockStats} />)
    expect(screen.getByText(/3 vulnerabilit/i)).toBeInTheDocument()
  })

  it('renders "Security data not available" when available is false and not permission denied', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        available: false, permissionDenied: false, vulnerabilities: null,
        dismissedVulnerabilities: null, hasSecurityPolicy: null,
        codeScanning: null, secretScanning: null, alerts: null,
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/not available/i)).toBeInTheDocument()
  })

  it('renders computing label when momentum is null', () => {
    const stats: RepoStats = { ...mockStats, momentum: null }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/computing/i)).toBeInTheDocument()
  })

  it('renders engagement section with skills learned count', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // Verdict tests
  it('renders "Healthy" verdict for a well-maintained repo with no vulns', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when high vulnerabilities exist', () => {
    render(<RepoStatsSidebar stats={criticalStats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })

  it('renders "Needs attention" verdict for stale repo', () => {
    render(<RepoStatsSidebar stats={staleStats} />)
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('renders "Stable" verdict for middling repo with no critical signals', () => {
    render(<RepoStatsSidebar stats={middlingStats} />)
    expect(screen.getByText('Stable')).toBeInTheDocument()
  })

  // Collapse tests
  it('collapses Momentum section when header is clicked', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText(/Commits\/month/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Momentum/i }))
    expect(screen.queryByText(/Commits\/month/i)).not.toBeInTheDocument()
  })

  it('collapses Security section when header is clicked', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    expect(screen.getByText(/Security policy/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Security/i }))
    expect(screen.queryByText(/Security policy/i)).not.toBeInTheDocument()
  })

  it('re-expands a collapsed section when header is clicked again', () => {
    render(<RepoStatsSidebar stats={healthyStats} />)
    const btn = screen.getByRole('button', { name: /Momentum/i })
    fireEvent.click(btn)
    expect(screen.queryByText(/Commits\/month/i)).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText(/Commits\/month/i)).toBeInTheDocument()
  })

  // ── New test cases ──────────────────────────────────────────────────────────

  it('renders "Token lacks permission" when permissionDenied is true', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        available: false, permissionDenied: true, vulnerabilities: null,
        dismissedVulnerabilities: null, hasSecurityPolicy: null,
        codeScanning: null, secretScanning: null, alerts: null,
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/token lacks permission/i)).toBeInTheDocument()
  })

  it('renders dismissed vulnerabilities count when total > 0', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        dismissedVulnerabilities: { critical: 1, high: 2, moderate: 0, low: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/3 dismissed/i)).toBeInTheDocument()
  })

  it('renders code scanning alert count when codeScanning is a counts object', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        codeScanning: { critical: 0, high: 1, medium: 2, low: 0, note: 0, warning: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/3 alerts/i)).toBeInTheDocument()
  })

  it('renders code scanning Absent dot when codeScanning is false', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: { ...mockStats.security, hasSecurityPolicy: null, codeScanning: false },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/Code scanning/i)).toBeInTheDocument()
    expect(screen.getByText(/● Absent/)).toBeInTheDocument()
  })

  it('renders secret scanning row with active count when active > 0', () => {
    const stats: RepoStats = {
      ...mockStats,
      security: {
        ...mockStats.security,
        secretScanning: { active: 2, inactive: 0, unknown: 1 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText(/2 active/i)).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when secretScanning has active > 0', () => {
    const stats: RepoStats = {
      ...healthyStats,
      security: {
        ...healthyStats.security,
        secretScanning: { active: 1, inactive: 0, unknown: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })

  it('renders "Critical issues" verdict when codeScanning has critical > 0', () => {
    const stats: RepoStats = {
      ...healthyStats,
      security: {
        ...healthyStats.security,
        codeScanning: { critical: 1, high: 0, medium: 0, low: 0, note: 0, warning: 0 },
      },
    }
    render(<RepoStatsSidebar stats={stats} />)
    expect(screen.getByText('Critical issues')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the UI tests — expect failures on new cases (service now passes)**

```bash
npx vitest run src/components/RepoStatsSidebar.test.tsx 2>&1 | tail -30
```

Expected: existing tests pass (fixtures are now correct), new test cases fail because the component hasn't been updated yet. Specifically these 7 should fail:
- "Token lacks permission"
- "dismissed vulnerabilities count"
- "code scanning alert count"
- "code scanning Absent dot"
- "secret scanning row"
- "Critical issues — secretScanning active > 0"
- "Critical issues — codeScanning critical > 0"

- [ ] **Step 3: Commit the tests**

```bash
git add src/components/RepoStatsSidebar.test.tsx
git commit -m "test(security): update sidebar tests for new security fields and add 8 new cases"
```

---

## Task 6: Implement UI changes

**Files:**
- Modify: `src/components/RepoStatsSidebar.tsx`

Four areas change: `computeVerdict`, the unavailable message, the security section body, and the code scanning row.

- [ ] **Step 1: Update `computeVerdict` — add secret scanning and code scanning escalation conditions**

Locate `computeVerdict` (currently lines 24–67). Replace the opening variable declarations and first `if` block:

Current:
```typescript
function computeVerdict(stats: RepoStats): Verdict {
  const { health, security, momentum } = stats
  const vulns = security.vulnerabilities
  const criticalVulns = vulns?.critical ?? 0
  const highVulns = vulns?.high ?? 0
  const totalVulns = vulns ? vulns.critical + vulns.high + vulns.moderate + vulns.low : 0

  if (security.available && (criticalVulns > 0 || highVulns > 0)) {
```

Replace with:
```typescript
function computeVerdict(stats: RepoStats): Verdict {
  const { health, security, momentum } = stats
  const vulns = security.vulnerabilities
  const criticalVulns = vulns?.critical ?? 0
  const highVulns = vulns?.high ?? 0
  const totalVulns = vulns ? vulns.critical + vulns.high + vulns.moderate + vulns.low : 0

  const hasActiveSecrets = security.secretScanning != null && security.secretScanning.active > 0
  const hasCriticalCodeScan =
    typeof security.codeScanning === 'object' &&
    security.codeScanning !== null &&
    (security.codeScanning.critical > 0 || security.codeScanning.high > 0)

  if (security.available && (criticalVulns > 0 || highVulns > 0 || hasActiveSecrets || hasCriticalCodeScan)) {
```

- [ ] **Step 2: Update the security unavailable message**

Locate the security section (around line 184):

Current:
```tsx
      {!security.available ? (
          <div className="stats-computing">Security data not available</div>
```

Replace with:
```tsx
      {!security.available ? (
          <div className="stats-computing">
            {security.permissionDenied
              ? 'Token lacks permission — grant security_events scope'
              : 'Security data not available'}
          </div>
```

- [ ] **Step 3: Add dismissed vulnerabilities row**

Locate the block that renders the open vuln count (around line 189):

```tsx
            {security.vulnerabilities && totalVulns > 0 && (
              <div className="stats-vuln-row">
                ...
              </div>
            )}
            {security.vulnerabilities && totalVulns === 0 && (
```

After the closing `)}` of the `totalVulns > 0` block and before the `totalVulns === 0` block, insert:

```tsx
            {security.dismissedVulnerabilities && (() => {
              const d = security.dismissedVulnerabilities!
              const dismissedTotal = d.critical + d.high + d.moderate + d.low
              return dismissedTotal > 0 ? (
                <div className="stats-vuln-dismissed">
                  <div className="stats-vuln-count" style={{ color: 'var(--t3)', fontSize: '0.82em' }}>
                    {dismissedTotal} dismissed
                  </div>
                  <div className="stats-vuln-breakdown">
                    {d.critical}c · {d.high}h · {d.moderate}m · {d.low}l
                  </div>
                </div>
              ) : null
            })()}
```

- [ ] **Step 4: Replace the code scanning row**

Locate the current code scanning row (around line 215):

```tsx
              {security.codeScanningEnabled !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Code scanning</span>
                  <Dot active={security.codeScanningEnabled} />
                </div>
              )}
```

Replace with:
```tsx
              {security.codeScanning !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Code scanning</span>
                  {security.codeScanning === false ? (
                    <Dot active={false} />
                  ) : (() => {
                    const cs = security.codeScanning!
                    const csTotal = cs.critical + cs.high + cs.medium + cs.low + cs.note + cs.warning
                    const csHasCritical = cs.critical > 0 || cs.high > 0
                    return (
                      <span style={{ color: csHasCritical ? 'var(--red)' : 'var(--green)' }}>
                        ● {csTotal} {csTotal === 1 ? 'alert' : 'alerts'}
                      </span>
                    )
                  })()}
                </div>
              )}
```

- [ ] **Step 5: Add the secret scanning row**

Immediately after the code scanning row closing `)}`, add:

```tsx
              {security.secretScanning !== null && (() => {
                const ss = security.secretScanning!
                const hasActive = ss.active > 0
                return (
                  <div className="stats-signal">
                    <span className="stats-signal-label">Secret scanning</span>
                    <span style={{ color: hasActive ? 'var(--red)' : 'var(--green)' }}>
                      ● {hasActive
                        ? `${ss.active} active · ${ss.inactive} inactive · ${ss.unknown} unknown`
                        : '0 active'}
                    </span>
                  </div>
                )
              })()}
```

- [ ] **Step 6: Run the UI tests**

```bash
npx vitest run src/components/RepoStatsSidebar.test.tsx 2>&1 | tail -30
```

Expected: all 22 tests pass.

- [ ] **Step 7: Run the full test suite to verify nothing regressed**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass across all files.

- [ ] **Step 8: Commit**

```bash
git add src/components/RepoStatsSidebar.tsx
git commit -m "feat(security): render secret scanning, quantitative code scanning, dismissed counts, and permission-denied message"
```

---

## Completion check

After all tasks are committed, verify:

```bash
npm test
```

Expected output: all test suites pass. The git log should show 6 commits added by this plan (types, useRepoStats fixture, service tests, service impl, UI tests, UI impl).
