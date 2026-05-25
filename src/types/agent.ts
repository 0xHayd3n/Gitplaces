export interface AgentFolderRow {
  id: string
  name: string
  color_start: string | null
  color_end:   string | null
  description: string | null
  emoji:       string | null
  created_at:  string
}

export interface AgentRow {
  id: string
  name: string
  handle: string                   // unique, kebab-case, no leading '@'
  folder_id: string | null
  color_start: string | null       // e.g. '#6366f1'
  color_end:   string | null       // null = solid swatch
  emoji:       string | null
  pinned:      0 | 1
  pinned_at:   string | null
  last_used_at: string | null
  presets_json: string             // raw JSON; parse with parseAgentPresets()
  created_at: string
  updated_at: string
  // Skill parity (Phase 1)
  description: string              // explicit description, defaults to ''
  origin_plugin: string | null     // populated by import; null for hand-authored
  origin_path: string | null       // e.g., 'skills/brainstorming'
  origin_version: string | null    // e.g., '5.1.0'
  origin_imported_at: string | null
  // Skill parity (Phase 2)
  tools: string | null             // JSON-serialized string[]; NULL = inherit all
  /**
   * Raw `model:` string from frontmatter. Phase 2 widened this from the
   * legacy 4-value enum ('sonnet'|'opus'|'haiku'|'inherit') to free-form
   * string so non-Anthropic models can be stored verbatim:
   *   - Legacy short names: 'sonnet', 'opus', 'haiku', 'inherit'
   *   - Full Anthropic IDs: 'claude-sonnet-4-6'
   *   - Multi-provider form: 'openai/gpt-4o', 'openai-compatible:ollama-local/llama3.1:70b'
   * Always paired with the denormalized `model_provider` + `model_endpoint_id`
   * columns; consumers that need structured data should read those.
   */
  model: string
  /** Denormalized from `model`. Defaults to 'anthropic'. One of the 5 ProviderId values. */
  model_provider: string
  /** Denormalized from `model`. Only set when provider === 'openai-compatible'. */
  model_endpoint_id: string | null
  is_subagent: 0 | 1
  is_slash_command: 0 | 1
  argument_hint: string | null
  synced_subagent_at: string | null
  synced_slash_command_at: string | null
}

export interface AgentFile {
  id: string
  agent_id: string
  filename: string                 // relative path within the skill dir, slashes allowed
  content: string
  sort_order: number
  created_at: string
  updated_at: string
  // Backup sync to gitsuite-skills (parallel to skills/notes sync)
  backup_github_sha:  string | null
  backup_synced_at:   number | null
  backup_sync_status: 'pending' | 'synced' | 'failed' | null
}

// Phase B+ uses these. Defined now so the AgentRevision interface for Phase C
// is also in place — avoids type churn between phases.
export interface AgentPreset {
  id:    string
  name:  string
  slug:  string
  values: Record<string, string>
}

export interface AgentRevision {
  id:       string
  agent_id: string
  body:     string
  presets:  AgentPreset[]
  summary:  string
  kind:     'create' | 'body_edit' | 'preset_change' | 'revert'
  created_at: string
}

export function parseAgentPresets(json: string): AgentPreset[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed as AgentPreset[] : []
  } catch {
    return []
  }
}

export function parseAgentTools(json: string | null): string[] | null {
  if (json === null) return null
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : null
  } catch {
    return null
  }
}

export function serializeAgentTools(arr: string[] | null): string | null {
  if (arr === null) return null
  return JSON.stringify(arr)
}
