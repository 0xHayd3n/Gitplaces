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
  const [alertsRes, profileRes, scanRes] = await Promise.all([
    fetch(`${base}/dependabot/alerts?state=open&per_page=100`, { headers: h }).catch(() => null),
    fetch(`${base}/community/profile`, { headers: h }).catch(() => null),
    fetch(`${base}/code-scanning/alerts?per_page=1`, { headers: h }).catch(() => null),
  ])

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
