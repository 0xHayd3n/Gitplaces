/** Mirrors the `repos` SQLite table schema. All IPC handlers that return repo data use this shape. */
export interface RepoRow {
  id: string
  owner: string
  name: string
  description: string | null
  language: string | null
  topics: string           // JSON string, e.g. '["cli","rust"]'
  stars: number | null
  forks: number | null
  license: string | null
  homepage: string | null
  updated_at: string | null
  pushed_at: string | null
  saved_at: string | null
  type: string | null
  banner_svg: string | null
  discovered_at: string | null
  discover_query: string | null
  watchers: number | null
  size: number | null
  open_issues: number | null
  starred_at: string | null
  unstarred_at: string | null  // Set when user unstars; cleared on re-star. Powers the Unstarred filter (last 30 days).
  default_branch: string | null
  avatar_url: string | null    // owner avatar URL from GitHub API
  og_image_url: string | null
  banner_color: string | null  // JSON: {"h":220,"s":0.6,"l":0.18} — derived from avatar
  // Phase 12 — translation cache
  translated_description: string | null
  translated_description_lang: string | null
  translated_readme: string | null
  translated_readme_lang: string | null
  detected_language: string | null
  // Phase 15 — verification
  verification_score:      number  | null
  verification_tier:       string  | null  // 'verified' | 'likely' | null
  verification_signals:    string  | null  // JSON array of signal names
  verification_checked_at: number  | null  // Unix timestamp
  // Phase 16 — nested repo type system
  type_bucket: string | null  // e.g. "dev-tools"
  type_sub:    string | null  // e.g. "algorithm"
  // Phase 23 — update notifications
  is_forked:         number | null   // 1 if user has a GitHub fork of this repo
  update_available:  number | null   // 1 if an update has been detected
  update_checked_at: number | null   // Unix timestamp of last check
  upstream_version:  string | null   // latest release tag or pushed_at
  stored_version:    string | null   // version at last save or update
}

export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  download_count: number
}

export interface ReleaseRow {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  assets: ReleaseAsset[]
  prerelease: boolean
}

/** Parse the JSON topics string from a RepoRow into a string array. */
export function parseTopics(topics: string | null): string[] {
  if (!topics) return []
  try { return JSON.parse(topics) as string[] } catch { return [] }
}

/** Format a star count: 76200 → "76.2k", 500 → "500" */
export function formatStars(n: number | null): string {
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

/** Returned by library:getAll — repos INNER JOIN skills.
 *  version and generated_at are nullable per DB schema.
 *  content/filename are fetched on-demand via skill:getContent. */
export interface LibraryRow extends RepoRow {
  installed: number  // 0 | 1 — whether a skill is installed (always 1 in library:getAll, 0 for uninstalled discover rows)
  active: number
  version: string | null
  generated_at: string | null
  enabled_components: string | null  // JSON string[] | null; null means all enabled
  enabled_tools: string | null       // JSON string[] | null; null means all enabled
  tier?: number  // 1 | 2 — skill generation quality tier
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

/** Returned by starred:getAll — repos WHERE starred_at IS NOT NULL, LEFT JOIN skills. */
export interface StarredRepoRow extends RepoRow {
  installed: number  // 0 or 1 — 1 if a skill exists for this repo
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
