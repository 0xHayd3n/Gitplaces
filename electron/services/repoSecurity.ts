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

  const [openRawAlerts, dismissedRawAlerts, scanAlerts, secretAlerts] = await Promise.all([
    fetchAllPages<RawAlert>(alertsRes, h),
    dismissedRes?.ok ? fetchAllPages<RawAlert>(dismissedRes, h) : Promise.resolve([]),
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
