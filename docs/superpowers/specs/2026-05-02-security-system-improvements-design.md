# Security System Improvements — Design Spec

**Date:** 2026-05-02
**Status:** Approved

## Overview

Extend the repository security system from Dependabot-only coverage to full GitHub security surface: add secret scanning, upgrade code scanning from binary to quantitative, separate permission-denied from unavailable states, shorten the cache TTL, and surface dismissed Dependabot alert counts for pattern detection.

## Files Affected

- `src/types/repoStats.ts` — type shape changes
- `electron/services/repoSecurity.ts` — service logic
- `electron/services/repoSecurity.test.ts` — service tests
- `src/components/RepoStatsSidebar.tsx` — UI rendering
- `src/components/RepoStatsSidebar.test.tsx` — UI tests
- `src/hooks/useRepoStats.test.ts` — fixture update only (`codeScanningEnabled` → `codeScanning`, add new fields)

---

## 1. Type Shape (`src/types/repoStats.ts`)

Extract three named interfaces for reuse across the security shape:

```typescript
export interface SeverityCounts {
  critical: number; high: number; moderate: number; low: number
}

export interface CodeScanningCounts {
  critical: number; high: number; medium: number; low: number; note: number; warning: number
}

export interface SecretScanningCounts {
  active: number; inactive: number; unknown: number
}
```

Update the `security` field on `RepoStats`:

```typescript
security: {
  available: boolean
  permissionDenied: boolean                         // true when available=false due to 403
  vulnerabilities: SeverityCounts | null            // open Dependabot alerts (unchanged)
  dismissedVulnerabilities: SeverityCounts | null   // dismissed Dependabot alert counts
  hasSecurityPolicy: boolean | null                 // unchanged
  codeScanning: CodeScanningCounts | false | null   // replaces codeScanningEnabled
                                                    // false=explicitly disabled (404)
                                                    // null=unknown/other status
  secretScanning: SecretScanningCounts | null       // null=unavailable or permission denied
  alerts: SecurityAlert[] | null                    // unchanged (open Dependabot alerts)
}
```

`SecurityAlert` interface is unchanged.

---

## 2. Service (`electron/services/repoSecurity.ts`)

### TTL

```typescript
const TTL_MS = 21_600_000 // 6h (was 24h)
```

### New Raw Types

```typescript
interface RawCodeScanAlert {
  rule: { severity: string }
}

interface RawSecretAlert {
  validity: 'active' | 'inactive' | 'unknown'
}
```

### `fetchAllPages<T>` Helper

Extract the existing pagination loop into a generic helper:

```typescript
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
```

### Parallel Initial Fetch (3 → 5)

```typescript
const [alertsRes, dismissedRes, profileRes, scanRes, secretRes] = await Promise.all([
  fetch(`${base}/dependabot/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
  fetch(`${base}/dependabot/alerts?state=dismissed&per_page=100`, { headers: h }).catch(() => null),
  fetch(`${base}/community/profile`, { headers: h }).catch(() => null),
  fetch(`${base}/code-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
  fetch(`${base}/secret-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
])
```

### 403 Handling

```typescript
if (alertsRes?.status === 403) return { ...UNAVAILABLE, permissionDenied: true }
if (!alertsRes?.ok) return UNAVAILABLE
```

`UNAVAILABLE` gains `permissionDenied: false` as its default.

### Concurrent Pagination (replaces inline loop)

The existing `const rawAlerts: RawAlert[] = await alertsRes.json()` call and the sequential pagination `while` loop are **removed entirely**. `fetchAllPages` is the sole consumer of every first-page response body — calling `.json()` on a response before passing it to `fetchAllPages` would silently produce empty results.

```typescript
const [openAlerts, dismissedAlerts, scanAlerts, secretAlerts] = await Promise.all([
  fetchAllPages<RawAlert>(alertsRes, h),
  dismissedRes?.ok ? fetchAllPages<RawAlert>(dismissedRes, h) : Promise.resolve([]),
  scanRes?.ok && scanRes.status !== 404 ? fetchAllPages<RawCodeScanAlert>(scanRes, h) : Promise.resolve([]),
  secretRes?.ok ? fetchAllPages<RawSecretAlert>(secretRes, h) : Promise.resolve([]),
])
```

Partial results (any combination of null secondary fields due to secondary endpoint failures) are always cached. Only the primary Dependabot 403 early-returns without caching.

### Field Derivation

**`codeScanning`**:
- `scanRes?.status === 404` → `false`
- `scanRes?.ok` → count `scanAlerts` by `rule.severity` into `CodeScanningCounts`
- otherwise → `null`

**`secretScanning`**:
- Secret scanning is fetched with `state=open` only. The `validity` field reflects the credential status of *unresolved* alerts: `active` = credential still live, `inactive` = credential rotated/revoked but alert not yet dismissed, `unknown` = GitHub cannot verify. This is intentional — `inactive` open alerts indicate unresolved housekeeping, while `active` open alerts are live threats.
- `secretRes?.ok` → count `secretAlerts` by `validity` into `SecretScanningCounts`
- otherwise → `null`

**`dismissedVulnerabilities`**:
- `dismissedRes?.ok` → map through existing `mapAlert`, count by severity
- otherwise → `null`

---

## 3. UI (`src/components/RepoStatsSidebar.tsx`)

### Permission Denied Message

```tsx
{!security.available ? (
  <div className="stats-computing">
    {security.permissionDenied
      ? 'Token lacks permission — grant security_events scope'
      : 'Security data not available'}
  </div>
) : ( /* existing content */ )}
```

### Dismissed Vulnerabilities Row

Shown below the open vuln row, only when dismissed total > 0, in a muted style:

```
⚠  3 vulnerabilities
   2c · 1h · 0m · 0l

   4 dismissed          ← new muted row
   1c · 2h · 1m · 0l
```

### Code Scanning Row

Replaces the `Dot` component with a count display:
- `codeScanning` is a counts object → render total alert count (red if any critical/high, else green)
- `codeScanning === false` → render `Dot active={false}` ("Absent")
- `codeScanning === null` → render nothing

### Secret Scanning Row

New row, rendered only when `secretScanning` is non-null:
- `active > 0` → render in red: `{active} active · {inactive} inactive · {unknown} unknown`
- `active === 0` → render in green: `0 active`

### Verdict Logic (`computeVerdict`)

Two new escalation conditions added to the "Critical issues" branch. Use these exact guards (TypeScript requires the discriminant check for the `false | null | object` union):

```typescript
// secret scanning active credential leak
security.secretScanning != null && security.secretScanning.active > 0

// code scanning critical/high findings (guard against false and null)
typeof security.codeScanning === 'object' &&
  security.codeScanning !== null &&
  (security.codeScanning.critical > 0 || security.codeScanning.high > 0)
```

---

## 4. Tests

### `repoSecurity.test.ts`

All existing tests updated to mock 5 fetch calls (add `dismissedRes` + `secretRes` mocks).

New cases:
- `permissionDenied: true` when Dependabot returns 403
- `dismissedVulnerabilities` counts correctly from dismissed endpoint
- `codeScanning === false` when scan endpoint returns 404
- `codeScanning` is counts object with correct severity breakdown when 200
- `codeScanning === null` when scan endpoint returns non-200/non-404
- `secretScanning` counts by validity correctly
- Pagination works independently for dismissed, code scan, and secret scan streams
- Stale cache threshold is 6h (not 24h)

### `RepoStatsSidebar.test.tsx`

All existing `security` fixture objects updated with new required fields:
`permissionDenied: false`, `dismissedVulnerabilities: null`, `codeScanning: null`, `secretScanning: null`

New cases:
- Renders "Token lacks permission" when `available: false, permissionDenied: true`
- Renders "Security data not available" when `available: false, permissionDenied: false`
- Renders dismissed count row when `dismissedVulnerabilities` total > 0
- Renders code scanning alert count when `codeScanning` is a counts object
- Renders code scanning "Absent" dot when `codeScanning === false`
- Renders secret scanning row with red styling when `active > 0`
- `computeVerdict` → "Critical issues" when `secretScanning.active > 0`
- `computeVerdict` → "Critical issues" when `codeScanning.critical > 0`
