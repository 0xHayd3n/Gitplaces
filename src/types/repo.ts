import type { HostType } from '../../electron/providers/types'

/** Canonical normalized repository shape consumed across the renderer.
 *  Provider-agnostic — Phases 4–5 add GitLab + Gitea providers that produce the same shape. */
export interface Repo {
  hostId: string
  hostType: HostType
  hostNativeId: string | number
  fullName: string                 // "owner/repo"
  owner: string
  name: string
  htmlUrl: string
  homepageUrl: string | null
  description: string | null
  language: string | null
  topics: string[]
  license: string | null           // SPDX id where available
  defaultBranch: string
  archived: boolean
  size: number                     // KB
  stars: number
  forks: number
  watchers: number
  openIssues: number
  createdAt: string                // ISO 8601
  updatedAt: string                // ISO 8601
  pushedAt: string                 // ISO 8601
  ownerAvatarUrl: string
}

/** `Repo` plus library/discovery/verification state — what `library:*`/`starred:*`
 *  IPC channels return after Task 5. Mirror of the SavedRepo extras enumerated in the
 *  field rename map. Every field is nullable because pre-existing rows are populated
 *  lazily by separate flows (engagement, verification, classification, etc.). */
export interface SavedRepo extends Repo {
  savedAt: string | null
  starredAt: string | null
  unstarredAt: string | null
  discoveredAt: string | null
  discoverQuery: string | null
  bannerSvg: string | null
  bannerColor: string | null
  ogImageUrl: string | null
  type: string | null
  typeBucket: string | null
  typeSub: string | null
  translatedDescription: string | null
  translatedDescriptionLang: string | null
  translatedReadme: string | null
  translatedReadmeLang: string | null
  detectedLanguage: string | null
  verificationScore: number | null
  verificationTier: string | null
  verificationSignals: string | null
  verificationCheckedAt: number | null
  isForked: number | null
  updateAvailable: number | null
  updateCheckedAt: number | null
  upstreamVersion: string | null
  storedVersion: string | null
  archivedAt: string | null
  forkedAt: string | null
  fetchedAt: number | null
  starredCheckedAt: number | null
  storybookUrl: string | null
}

/** `SavedRepo` plus the columns added by `library:getAll` joining `skills`. */
export interface LibrarySavedRepo extends SavedRepo {
  installed: number                // 0 | 1
  active: number                   // 0 | 1
  version: string | null
  generatedAt: string | null
  enabledComponents: string | null
  enabledTools: string | null
  tier?: number
}

/** Single release entry (camelCase). Replaces both `GitHubRelease` (live API) and `ReleaseRow` (legacy renderer). */
export interface ReleaseAsset {
  name: string
  size: number
  browserDownloadUrl: string
  downloadCount: number
}
export interface Release {
  tagName: string
  name: string | null
  publishedAt: string
  body: string | null
  assets: ReleaseAsset[]
  prerelease: boolean
}

/** Authenticated user info. Replaces `GitHubUser`. */
export interface User {
  login: string
  avatarUrl: string
  publicRepos: number
}

/** Output of `github:getStarred`. Replaces `GitHubStarredRepo`. */
export interface StarredEntry {
  starredAt: string
  repo: Repo
}

/** Format a star count: 76200 → "76.2k", 500 → "500" */
export function formatStars(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export interface SkillRow {
  repo_id: string
  filename: string
  content: string
  version: string
  generated_at: string
  active: number
  enabled_components: string | null
  enabled_tools: string | null
  tier?: number
  // Phase 1/2 — anatomy engine (present only for anatomy-sourced skills)
  anatomy_source?: string | null      // 'committed' | 'generated' | null
  anatomy_commit?: string | null
  anatomy_fingerprint?: string | null
  anatomy_memory?: string | null
  anatomy_brief?: string | null
  anatomy_verify?: string | null      // JSON AnatomyVerifyResult
}

export interface SubSkillRow {
  repo_id: string
  skill_type: string          // 'components' | future types
  filename: string
  content: string
  version: string | null
  generated_at: string | null // nullable — matches DB schema (TEXT, no NOT NULL)
  active: number
}

export interface CollectionRow {
  id: string
  name: string
  description: string | null
  owner: string          // 'user' = mine; anything else = community owner handle
  active: number         // 0 | 1
  created_at: string | null
  color_start: string | null
  color_end: string | null
  repo_count: number     // total repos in this collection (from COUNT join)
  saved_count: number    // repos that have an installed skill (from SUM join)
}

export interface CollectionRepoRow {
  owner: string
  name: string
  language: string | null
  version: string | null         // from skills.version — null if not installed
  content_size: number | null    // length(skills.content) in bytes — null if not installed
  saved: number                  // 1 if skill installed, 0 if missing
}

// ── Anatomy engine (renderer-facing; parsed in main via skill:getAnatomy) ──
export interface AnatomyModelView {
  identity: Record<string, unknown>
  generated: Record<string, unknown>
  operation?: Record<string, unknown>
  substance?: Record<string, unknown>
  rules: Array<{ statement: string; verify?: { kind: string } }>
  decisions: Array<{ decision: string; rationale?: string }>
}
export interface AnatomyMemoryEntryView {
  text: string; kind?: string; at?: string; superseded?: boolean
  last_verified_at?: string; verified_by?: string
}
export interface AnatomyVerifyView {
  ok: boolean; errors: string[]; warnings: string[]
  rules: Array<{ statement: string; kind: string; status: 'pass' | 'fail' | 'unverified'; detail?: string }>
  skipped: string[]
}
export interface AnatomyPayload {
  source: string; commit: string | null; fingerprint: string | null
  rawContent: string; rawMemory: string | null
  model: AnatomyModelView | null
  memory: AnatomyMemoryEntryView[]
  verify: AnatomyVerifyView | null
}
