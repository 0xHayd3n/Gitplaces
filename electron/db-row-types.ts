// electron/db-row-types.ts
//
// Snake_case row shapes that mirror the SQLite schema. ONLY the main process
// imports from here — SELECT * results land in these types before normalizers
// produce the canonical camelCase Repo/SavedRepo shapes that cross IPC.
//
// The renderer must never import this file. If you find yourself reaching for
// it from src/, you want `Repo` or `SavedRepo` instead.

export interface RepoRow {
  id: string
  owner: string
  name: string
  description: string | null
  language: string | null
  topics: string                 // JSON: '["cli","rust"]'
  stars: number | null
  forks: number | null
  license: string | null
  homepage: string | null
  updated_at: string | null
  pushed_at: string | null
  created_at: string | null
  saved_at: string | null
  starred_at: string | null
  unstarred_at: string | null
  type: string | null
  banner_svg: string | null
  discovered_at: string | null
  discover_query: string | null
  watchers: number | null
  size: number | null
  open_issues: number | null
  default_branch: string | null
  avatar_url: string | null
  og_image_url: string | null
  banner_color: string | null
  translated_description: string | null
  translated_description_lang: string | null
  translated_readme: string | null
  translated_readme_lang: string | null
  detected_language: string | null
  verification_score: number | null
  verification_tier: string | null
  verification_signals: string | null
  verification_checked_at: number | null
  type_bucket: string | null
  type_sub: string | null
  is_forked: number | null
  update_available: number | null
  update_checked_at: number | null
  upstream_version: string | null
  stored_version: string | null
  archived_at: string | null
  forked_at: string | null
  fetched_at: number | null
  starred_checked_at: number | null
  storybook_url: string | null
  host_id: string                // Phase 1 added this column
}

export interface LibraryRow extends RepoRow {
  installed: number
  active: number
  version: string | null
  generated_at: string | null
  enabled_components: string | null
  enabled_tools: string | null
  tier?: number
}

export interface StarredRepoRow extends RepoRow {
  installed: number
}
