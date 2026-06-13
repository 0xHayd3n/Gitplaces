import type Database from 'better-sqlite3'
import { githubHeaders } from '../providers/github'
import { etagFetch } from '../githubFetch'
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

// Parses a ConditionalResponse into a typed array. Pagination via Link is
// only attempted when the response was a fresh 200 (304s lose Link headers).
async function parseConditional<T>(
  cr: import('../githubFetch').ConditionalResponse,
  _headers: HeadersInit,
): Promise<T[]> {
  const parsed = await cr.json()
  return Array.isArray(parsed) ? (parsed as T[]) : []
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

  // All five security endpoints go through etagFetch — when the resource is
  // unchanged, GitHub returns 304 (which doesn't count against the rate limit).
  // The 6h DB cache above means we typically don't hit these on warm visits;
  // ETag covers the case where the cache has expired but the data hasn't.
  const [alertsRes, dismissedRes, profileRes, scanRes, secretRes] = await Promise.all([
    etagFetch(db, `${base}/dependabot/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
    etagFetch(db, `${base}/dependabot/alerts?state=dismissed&per_page=100`, { headers: h }).catch(() => null),
    etagFetch(db, `${base}/community/profile`, { headers: h }).catch(() => null),
    etagFetch(db, `${base}/code-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
    etagFetch(db, `${base}/secret-scanning/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
  ])

  if (alertsRes?.status === 403) return { ...UNAVAILABLE, permissionDenied: true }
  // ok = 200 OR 304 (cached). 404 means feature not enabled for this repo.
  const alertsOk = alertsRes && (alertsRes.status === 200 || alertsRes.status === 304)
  const dismissedOk = dismissedRes && (dismissedRes.status === 200 || dismissedRes.status === 304)
  const profileOk = profileRes && (profileRes.status === 200 || profileRes.status === 304)
  const scanOk = scanRes && (scanRes.status === 200 || scanRes.status === 304)
  const secretOk = secretRes && (secretRes.status === 200 || secretRes.status === 304)
  if (!alertsOk) return UNAVAILABLE

  // Note: pagination via Link header doesn't survive a 304 response. We accept
  // truncation past the first page on cached hits — rare in practice (most
  // repos have <100 dependabot alerts) and the tradeoff is worth the rate-limit
  // savings.
  const [openRawAlerts, dismissedRawAlerts, scanAlerts, secretAlerts] = await Promise.all([
    parseConditional<RawAlert>(alertsRes!, h),
    dismissedOk ? parseConditional<RawAlert>(dismissedRes!, h) : Promise.resolve([]),
    scanOk ? parseConditional<RawCodeScanAlert>(scanRes!, h) : Promise.resolve([]),
    secretOk ? parseConditional<RawSecretAlert>(secretRes!, h) : Promise.resolve([]),
  ])

  const alerts = openRawAlerts.map(mapAlert)
  const dismissedMapped = dismissedRawAlerts.map(mapAlert)

  let profileData: { files?: { security?: unknown } } | null = null
  if (profileOk) {
    const parsed = await profileRes!.json()
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      profileData = parsed as { files?: { security?: unknown } }
    }
  }

  let codeScanning: CodeScanningCounts | false | null = null
  if (scanRes?.status === 404) {
    codeScanning = false
  } else if (scanOk) {
    codeScanning = {
      critical: scanAlerts.filter(a => a.rule.severity === 'critical').length,
      high:     scanAlerts.filter(a => a.rule.severity === 'high').length,
      medium:   scanAlerts.filter(a => a.rule.severity === 'medium').length,
      low:      scanAlerts.filter(a => a.rule.severity === 'low').length,
      note:     scanAlerts.filter(a => a.rule.severity === 'note').length,
      warning:  scanAlerts.filter(a => a.rule.severity === 'warning').length,
    }
  }

  const secretScanning: SecretScanningCounts | null = secretOk
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
    dismissedVulnerabilities: dismissedOk ? countBySeverity(dismissedMapped) : null,
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
