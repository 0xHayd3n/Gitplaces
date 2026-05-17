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
    );
    CREATE TABLE http_etag_cache (
      url TEXT PRIMARY KEY,
      etag TEXT NOT NULL,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
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

  it('returns first page of open dependabot alerts; pagination intentionally skipped (rate-limit tradeoff)', async () => {
    const db = createDb()
    const page1 = [makeAlert('high', 1), makeAlert('high', 2)]

    // page1 carries a `rel="next"` Link, but getRepoSecurity uses
    // parseConditional (single read, no Link follow) by design — see the
    // documented tradeoff in repoSecurity.ts. So only page1 is counted and
    // there are exactly 5 etag fetches (the page-2 follow never happens).
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

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.alerts).toHaveLength(2)
    expect(result.vulnerabilities?.high).toBe(2)
    expect(result.vulnerabilities?.moderate).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(5)
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
      .mockResolvedValueOnce(new Response('', { status: 403 }))

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.secretScanning).toBeNull()
  })

  it('counts first page of dismissed dependabot alerts (no pagination by design)', async () => {
    const db = createDb()
    const dismissedP1 = [makeAlert('high', 101), makeAlert('high', 102)]

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

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.dismissedVulnerabilities).toEqual({ critical: 0, high: 2, moderate: 0, low: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('counts first page of code scanning alerts (no pagination by design)', async () => {
    const db = createDb()
    const scanP1 = [makeCodeScanAlert('high'), makeCodeScanAlert('medium')]

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

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.codeScanning).toEqual({ critical: 0, high: 1, medium: 1, low: 0, note: 0, warning: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('counts first page of secret scanning alerts (no pagination by design)', async () => {
    const db = createDb()
    const secretP1 = [makeSecretAlert('active'), makeSecretAlert('active')]

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

    const result = await getRepoSecurity(db, 'owner', 'repo', 'token')

    expect(result.secretScanning).toEqual({ active: 2, inactive: 0, unknown: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })
})
