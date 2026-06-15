// electron/githubGraphql.ts
//
// Single GraphQL query that replaces five separate REST calls for the
// RepoDetail page load:
//
//   getRepo          → repository(...) fields
//   getReleases      → repository.releases connection
//   isStarred        → repository.viewerHasStarred
//   /community/profile (hasSecurityPolicy) → repository.securityPolicyUrl
//   /dependabot/alerts (open + dismissed)   → repository.vulnerabilityAlerts
//
// One GraphQL request goes through `https://api.github.com/graphql` and
// returns all of the above in a single round-trip. Cuts cold-load calls for
// the Activities page from ~9 to ~4.
//
// What we DON'T move to GraphQL (kept as REST):
//   - /contributors?per_page=1   (GraphQL has no equivalent count)
//   - /code-scanning/alerts      (not exposed)
//   - /secret-scanning/alerts    (not exposed)
//   - /stats/commit_activity     (not exposed; lazy via getRepoMomentum)

import { etagFetch } from '../../githubFetch'
import type Database from 'better-sqlite3'

const DEFAULT_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

/** Compute the GraphQL endpoint URL for a given GitHub baseUrl.
 *  - api.github.com → api.github.com/graphql
 *  - GHE github.acme.com/api/v3 → github.acme.com/api/graphql */
export function graphqlEndpointFor(baseUrl: string): string {
  if (baseUrl === 'https://api.github.com') return DEFAULT_GRAPHQL_ENDPOINT
  const root = baseUrl.replace(/\/api\/v3\/?$/, '').replace(/\/+$/, '')
  return `${root}/api/graphql`
}

const REPO_BUNDLE_QUERY = /* GraphQL */ `
  query RepoBundle($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      databaseId
      name
      nameWithOwner
      description
      homepageUrl
      isArchived
      primaryLanguage { name }
      stargazerCount
      forkCount
      issues(states: OPEN) { totalCount }
      licenseInfo { spdxId }
      repositoryTopics(first: 30) { nodes { topic { name } } }
      owner { login avatarUrl }
      defaultBranchRef {
        name
        target {
          ... on Commit {
            tree {
              oid
              entries {
                name
                type
                oid
                mode
                object { ... on Blob { byteSize } }
              }
            }
          }
        }
      }
      updatedAt
      pushedAt
      createdAt
      diskUsage
      watchers { totalCount }
      viewerHasStarred
      securityPolicyUrl
      releases(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          tagName
          name
          publishedAt
          description
          isPrerelease
          releaseAssets(first: 10) {
            nodes { name size downloadUrl downloadCount }
          }
        }
      }
      openVulns: vulnerabilityAlerts(first: 100, states: [OPEN]) {
        nodes {
          number
          dependencyScope
          securityVulnerability {
            severity
            firstPatchedVersion { identifier }
            package { name ecosystem }
          }
          securityAdvisory {
            ghsaId
            cveId: identifiers { value type }
            summary
          }
          vulnerableManifestPath
        }
      }
      dismissedVulns: vulnerabilityAlerts(first: 100, states: [DISMISSED]) {
        nodes {
          securityVulnerability { severity }
        }
      }
    }
  }
`

// ── GraphQL response shapes (subset of what we asked for) ───────────────────

interface GqlAsset {
  name: string
  size: number
  downloadUrl: string
  downloadCount: number
}

interface GqlRelease {
  tagName: string
  name: string | null
  publishedAt: string
  description: string | null
  isPrerelease: boolean
  releaseAssets: { nodes: GqlAsset[] }
}

interface GqlVulnAlert {
  number: number
  dependencyScope: string | null
  securityVulnerability: {
    severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW'
    firstPatchedVersion: { identifier: string } | null
    package: { name: string; ecosystem: string }
  }
  securityAdvisory: {
    ghsaId: string
    cveId: { value: string; type: string }[]
    summary: string
  }
  vulnerableManifestPath: string | null
}

interface GqlRepository {
  databaseId: number
  name: string
  nameWithOwner: string
  description: string | null
  homepageUrl: string | null
  isArchived: boolean
  primaryLanguage: { name: string } | null
  stargazerCount: number
  forkCount: number
  issues: { totalCount: number }
  licenseInfo: { spdxId: string } | null
  repositoryTopics: { nodes: { topic: { name: string } }[] }
  owner: { login: string; avatarUrl: string }
  defaultBranchRef: {
    name: string
    target: {
      tree: {
        oid: string
        entries: Array<{
          name: string
          type: 'blob' | 'tree' | 'commit'
          oid: string
          mode: number
          object: { byteSize: number } | null
        }>
      } | null
    } | null
  } | null
  updatedAt: string
  pushedAt: string
  createdAt: string
  diskUsage: number
  watchers: { totalCount: number }
  viewerHasStarred: boolean
  securityPolicyUrl: string | null
  releases: { nodes: GqlRelease[] }
  openVulns: { nodes: GqlVulnAlert[] }
  dismissedVulns: { nodes: GqlVulnAlert[] }
}

interface GqlResponse {
  data?: { repository: GqlRepository | null }
  errors?: { message: string; type?: string }[]
}

// ── Mapped output (consumed by the renderer) ────────────────────────────────

import type { RepoStats, SecurityAlert } from '../../../src/types/repoStats'

export interface RepoBundle {
  /** Maps to the existing GitHubRepo / RepoRow shape used in the renderer. */
  repo: {
    id: number
    name: string
    full_name: string
    description: string | null
    language: string | null
    topics: string[]
    stargazers_count: number
    forks_count: number
    watchers_count: number
    open_issues_count: number
    size: number  // KB
    license: { spdx_id: string } | null
    homepage: string | null
    updated_at: string
    pushed_at: string
    created_at: string
    default_branch: string
    archived: boolean
    owner: { login: string; avatar_url: string }
    html_url: string
  }
  releases: {
    tag_name: string
    name: string | null
    published_at: string
    body: string | null
    assets: { name: string; size: number; browser_download_url: string; download_count: number }[]
    prerelease: boolean
  }[]
  isStarred: boolean
  /** When non-null, hasSecurityPolicy = true; null means no security policy. */
  securityPolicyUrl: string | null
  /** Subset of RepoStats['security'] derivable from GraphQL alone. */
  vulnerabilities: {
    open: SecurityAlert[]
    dismissedBySeverity: { critical: number; high: number; moderate: number; low: number }
  }
  /** Default-branch root tree, prefetched alongside the bundle. Lets the
   *  Files tab skip its initial getBranch + getTree calls. May be null if
   *  the repo has no default branch or no commits. */
  rootTree: {
    sha: string
    entries: Array<{
      path: string   // 'name' from GraphQL, renamed to match TreeEntry shape
      mode: string   // stringified from numeric for consistency with REST
      type: 'blob' | 'tree' | 'commit'
      sha: string
      size?: number
    }>
  } | null
}

// ── Public ──────────────────────────────────────────────────────────────────

export async function fetchRepoBundle(
  db: Database.Database,
  token: string,
  owner: string,
  name: string,
  graphqlUrl: string = DEFAULT_GRAPHQL_ENDPOINT,
): Promise<RepoBundle | null> {
  const headers: HeadersInit = {
    Authorization: `bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify({ query: REPO_BUNDLE_QUERY, variables: { owner, name } })

  // GraphQL POST requests don't benefit from ETag/If-None-Match (the etag
  // depends on the request body). We still go direct; the surrounding TTL
  // caches in main.ts handle warm-visit deduplication for the underlying data.
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  void db // reserved for future ETag-on-graphql-by-hash; not used today

  if (!res || !res.ok) return null
  const json = (await res.json().catch(() => null)) as GqlResponse | null
  if (!json?.data?.repository) return null

  return mapRepository(json.data.repository, owner)
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function mapSeverity(s: GqlVulnAlert['securityVulnerability']['severity']): SecurityAlert['severity'] {
  return s.toLowerCase() as SecurityAlert['severity']
}

function mapAlert(a: GqlVulnAlert): SecurityAlert {
  const cve = a.securityAdvisory.cveId.find(i => i.type === 'CVE')?.value ?? null
  return {
    number: a.number,
    package: a.securityVulnerability.package.name,
    ecosystem: a.securityVulnerability.package.ecosystem.toLowerCase(),
    manifestPath: a.vulnerableManifestPath ?? '',
    severity: mapSeverity(a.securityVulnerability.severity),
    cveId: cve,
    ghsaId: a.securityAdvisory.ghsaId,
    summary: a.securityAdvisory.summary,
    fixVersion: a.securityVulnerability.firstPatchedVersion?.identifier ?? null,
    url: `https://github.com/security/advisories/${a.securityAdvisory.ghsaId}`,
  }
}

// ── Batched last-commit fetcher (Files-tab decoration) ──────────────────────

import type { LastCommitInfo } from './rest'

const BATCH_SIZE = 50

/**
 * Fetch the most recent commit that touched each path on `branch`. Issues
 * one GraphQL query per `BATCH_SIZE` paths using aliases. Returns a map of
 * path → commit info (or null if the path has no history on this branch).
 */
export async function fetchLastCommitsForPaths(
  token: string,
  owner: string,
  name: string,
  branch: string,
  paths: readonly string[],
  graphqlUrl: string = DEFAULT_GRAPHQL_ENDPOINT,
): Promise<Map<string, LastCommitInfo | null>> {
  const result = new Map<string, LastCommitInfo | null>()
  if (paths.length === 0) return result

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const chunk = paths.slice(i, i + BATCH_SIZE)
    const aliases = chunk.map((_, j) => {
      const idx = i + j
      return `f${idx}: history(first: 1, path: $p${idx}) { nodes { oid messageHeadline committedDate author { name avatarUrl user { login } } } }`
    }).join('\n            ')
    const varDecls = chunk.map((_, j) => `$p${i + j}: String!`).join(', ')
    const variables: Record<string, string> = { owner, name, branch }
    chunk.forEach((p, j) => { variables[`p${i + j}`] = p })

    const query = `
      query LastCommitsBatch($owner: String!, $name: String!, $branch: String!, ${varDecls}) {
        repository(owner: $owner, name: $name) {
          ref(qualifiedName: $branch) {
            target {
              ... on Commit {
                ${aliases}
              }
            }
          }
        }
      }
    `

    const headers: HeadersInit = {
      Authorization: `bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }

    const res = await fetch(graphqlUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)

    if (!res || !res.ok) {
      for (const p of chunk) result.set(p, null)
      continue
    }
    const json = await res.json().catch(() => null) as { data?: { repository?: { ref?: { target?: Record<string, { nodes: Array<{ oid: string; messageHeadline: string; committedDate: string; author: { name: string | null; avatarUrl: string | null; user: { login: string } | null } }> }> } } } } | null
    const target = json?.data?.repository?.ref?.target
    if (!target) {
      for (const p of chunk) result.set(p, null)
      continue
    }
    chunk.forEach((p, j) => {
      const idx = i + j
      const entry = target[`f${idx}`]
      const node = entry?.nodes?.[0]
      if (!node) {
        result.set(p, null)
        return
      }
      result.set(p, {
        message: node.messageHeadline,
        author_login: node.author.user?.login ?? null,
        author_avatar: node.author.avatarUrl ?? null,
        committed_at: node.committedDate,
        commit_sha: node.oid,
      })
    })
  }

  return result
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function mapRepository(r: GqlRepository, owner: string): RepoBundle {
  const dismissedBySeverity = {
    critical: 0, high: 0, moderate: 0, low: 0,
  }
  for (const a of r.dismissedVulns.nodes) {
    const sev = mapSeverity(a.securityVulnerability.severity)
    dismissedBySeverity[sev] += 1
  }

  return {
    repo: {
      id: r.databaseId,
      name: r.name,
      full_name: r.nameWithOwner,
      description: r.description,
      language: r.primaryLanguage?.name ?? null,
      topics: r.repositoryTopics.nodes.map(n => n.topic.name),
      stargazers_count: r.stargazerCount,
      forks_count: r.forkCount,
      watchers_count: r.watchers.totalCount,
      open_issues_count: r.issues.totalCount,
      size: r.diskUsage,
      license: r.licenseInfo ? { spdx_id: r.licenseInfo.spdxId } : null,
      homepage: r.homepageUrl,
      updated_at: r.updatedAt,
      pushed_at: r.pushedAt,
      created_at: r.createdAt,
      default_branch: r.defaultBranchRef?.name ?? 'main',
      archived: r.isArchived,
      owner: { login: r.owner.login, avatar_url: r.owner.avatarUrl },
      html_url: `https://github.com/${owner}/${r.name}`,
    },
    releases: r.releases.nodes.map(rel => ({
      tag_name: rel.tagName,
      name: rel.name,
      published_at: rel.publishedAt,
      body: rel.description,
      assets: rel.releaseAssets.nodes.map(a => ({
        name: a.name,
        size: a.size,
        browser_download_url: a.downloadUrl,
        download_count: a.downloadCount,
      })),
      prerelease: rel.isPrerelease,
    })),
    isStarred: r.viewerHasStarred,
    securityPolicyUrl: r.securityPolicyUrl,
    vulnerabilities: {
      open: r.openVulns.nodes.map(mapAlert),
      dismissedBySeverity,
    },
    rootTree: r.defaultBranchRef?.target?.tree
      ? {
          sha: r.defaultBranchRef.target.tree.oid,
          entries: r.defaultBranchRef.target.tree.entries.map(e => ({
            path: e.name,
            mode: String(e.mode),
            type: e.type,
            sha: e.oid,
            size: e.object?.byteSize,
          })),
        }
      : null,
  }
}
