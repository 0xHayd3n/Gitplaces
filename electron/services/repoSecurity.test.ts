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
