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
  body: string
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
