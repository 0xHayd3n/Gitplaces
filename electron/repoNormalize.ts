// electron/repoNormalize.ts
//
// SQLite-row (snake_case) ↔ canonical-Repo (camelCase) translation.
// All IPC handlers that read or write the `repos` family of tables run their
// payloads through these helpers so the renderer never sees snake_case fields.

import type { Repo, SavedRepo, LibrarySavedRepo } from '../src/types/repo'
import type { HostType } from './providers/types'
import type { RepoRow, LibraryRow } from './db-row-types'

function hostTypeFromHostId(hostId: string): HostType {
  if (hostId.startsWith('gh:')) return 'github'
  if (hostId.startsWith('gl:')) return 'gitlab'
  if (hostId.startsWith('gt:')) return 'gitea'
  // Default to github when unknown (e.g. legacy rows written before host_id existed).
  return 'github'
}

function parseTopicsJson(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function buildHtmlUrl(hostId: string, owner: string, name: string): string {
  // hostId is e.g. "gh:api.github.com" — the web URL strips the "api." subdomain.
  // Phase 3+ will plumb the canonical web URL through HostInstance.webUrl instead.
  if (hostId.startsWith('gh:')) return `https://github.com/${owner}/${name}`
  if (hostId.startsWith('gl:')) {
    const host = hostId.slice(3)
    return `https://${host}/${owner}/${name}`
  }
  if (hostId.startsWith('gt:')) {
    const host = hostId.slice(3)
    return `https://${host}/${owner}/${name}`
  }
  return `https://github.com/${owner}/${name}`
}

export function repoRowToSavedRepo(row: RepoRow): SavedRepo {
  const hostId = row.host_id ?? 'gh:api.github.com'
  const hostType = hostTypeFromHostId(hostId)
  return {
    hostId,
    hostType,
    hostNativeId: row.id,
    fullName: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    htmlUrl: buildHtmlUrl(hostId, row.owner, row.name),
    homepageUrl: row.homepage,
    description: row.description,
    language: row.language,
    topics: parseTopicsJson(row.topics),
    license: row.license,
    defaultBranch: row.default_branch && row.default_branch.length > 0 ? row.default_branch : 'main',
    archived: false,        // RepoRow has no archived flag; populated by separate flows
    size: row.size ?? 0,
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    watchers: row.watchers ?? 0,
    openIssues: row.open_issues ?? 0,
    createdAt: row.created_at ?? row.updated_at ?? '',
    updatedAt: row.updated_at ?? '',
    pushedAt: row.pushed_at ?? row.updated_at ?? '',
    ownerAvatarUrl: row.avatar_url ?? '',
    // ── SavedRepo extras ────────────────────────────────────────
    savedAt: row.saved_at,
    starredAt: row.starred_at,
    unstarredAt: row.unstarred_at,
    discoveredAt: row.discovered_at,
    discoverQuery: row.discover_query,
    bannerSvg: row.banner_svg,
    bannerColor: row.banner_color,
    ogImageUrl: row.og_image_url,
    type: row.type,
    typeBucket: row.type_bucket,
    typeSub: row.type_sub,
    translatedDescription: row.translated_description,
    translatedDescriptionLang: row.translated_description_lang,
    translatedReadme: row.translated_readme,
    translatedReadmeLang: row.translated_readme_lang,
    detectedLanguage: row.detected_language,
    verificationScore: row.verification_score,
    verificationTier: row.verification_tier,
    verificationSignals: row.verification_signals,
    verificationCheckedAt: row.verification_checked_at,
    isForked: row.is_forked,
    updateAvailable: row.update_available,
    updateCheckedAt: row.update_checked_at,
    upstreamVersion: row.upstream_version,
    storedVersion: row.stored_version,
    archivedAt: row.archived_at,
    forkedAt: row.forked_at,
    fetchedAt: row.fetched_at,
    starredCheckedAt: row.starred_checked_at,
    storybookUrl: row.storybook_url,
  }
}

export function libraryRowToLibrarySavedRepo(row: LibraryRow): LibrarySavedRepo {
  return {
    ...repoRowToSavedRepo(row),
    installed: row.installed,
    active: row.active,
    version: row.version,
    generatedAt: row.generated_at,
    enabledComponents: row.enabled_components,
    enabledTools: row.enabled_tools,
    tier: row.tier,
  }
}

/** Project a `SavedRepo` back to a `RepoRow` for INSERT/UPDATE statements.
 *  Lossless on the SavedRepo fields; loses `hostType` (derivable from host_id). */
export function savedRepoToRow(r: SavedRepo): RepoRow {
  return {
    id: typeof r.hostNativeId === 'string' ? r.hostNativeId : String(r.hostNativeId),
    owner: r.owner,
    name: r.name,
    description: r.description,
    language: r.language,
    topics: JSON.stringify(r.topics),
    stars: r.stars,
    forks: r.forks,
    license: r.license,
    homepage: r.homepageUrl,
    updated_at: r.updatedAt,
    pushed_at: r.pushedAt,
    created_at: r.createdAt,
    saved_at: r.savedAt,
    starred_at: r.starredAt,
    unstarred_at: r.unstarredAt,
    type: r.type,
    banner_svg: r.bannerSvg,
    discovered_at: r.discoveredAt,
    discover_query: r.discoverQuery,
    watchers: r.watchers,
    size: r.size,
    open_issues: r.openIssues,
    default_branch: r.defaultBranch,
    avatar_url: r.ownerAvatarUrl,
    og_image_url: r.ogImageUrl,
    banner_color: r.bannerColor,
    translated_description: r.translatedDescription,
    translated_description_lang: r.translatedDescriptionLang,
    translated_readme: r.translatedReadme,
    translated_readme_lang: r.translatedReadmeLang,
    detected_language: r.detectedLanguage,
    verification_score: r.verificationScore,
    verification_tier: r.verificationTier,
    verification_signals: r.verificationSignals,
    verification_checked_at: r.verificationCheckedAt,
    type_bucket: r.typeBucket,
    type_sub: r.typeSub,
    is_forked: r.isForked,
    update_available: r.updateAvailable,
    update_checked_at: r.updateCheckedAt,
    upstream_version: r.upstreamVersion,
    stored_version: r.storedVersion,
    archived_at: r.archivedAt,
    forked_at: r.forkedAt,
    fetched_at: r.fetchedAt,
    starred_checked_at: r.starredCheckedAt,
    storybook_url: r.storybookUrl,
    host_id: r.hostId,
  }
}
