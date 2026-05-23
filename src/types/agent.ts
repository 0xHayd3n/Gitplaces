export interface AgentFolderRow {
  id: string
  name: string
  color_start: string | null
  color_end:   string | null
  description: string | null
  created_at:  string
}

export interface AgentRow {
  id: string
  name: string
  body: string
  folder_id: string | null
  created_at: string
  updated_at: string
}
