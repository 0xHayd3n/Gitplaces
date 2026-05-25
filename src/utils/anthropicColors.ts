// Canonical Anthropic agent palette → hex.
// Lives in src/utils/ (renderer-safe) so the import dialog can use it without
// dragging in the Node-only pluginImportService module (better-sqlite3, fs).

export const COLOR_MAP: Record<string, string> = {
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green:  '#22c55e',
  cyan:   '#06b6d4',
  blue:   '#3b82f6',
  purple: '#a855f7',
  pink:   '#ec4899',
}
