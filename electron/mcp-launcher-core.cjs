// CommonJS module — required by both the standalone launcher and the test
// suite. No Electron imports.
//
// Pure resolvers over a better-sqlite3 Database handle. The launcher opens
// the DB; this file is transport-agnostic.

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function substituteVariables(body, values) {
  return body.replace(new RegExp(VARIABLE_RE.source, 'g'), (raw, name) => {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : raw
  })
}

function deriveDescription(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    return trimmed.length > 200 ? trimmed.slice(0, 199) + '…' : trimmed
  }
  return ''
}

function parsePresets(json) {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Body comes from agent_files (sort_order=0, the primary file row) post-Phase-26.
function readPrimaryBody(db, agentId) {
  const row = db.prepare(
    `SELECT content FROM agent_files WHERE agent_id = ? AND sort_order = 0`
  ).get(agentId)
  return row ? row.content : null
}

function getCatalog(db) {
  const rows = db.prepare(`
    SELECT a.handle, a.name, a.presets_json, f.content AS body
    FROM agents a
    LEFT JOIN agent_files f ON f.agent_id = a.id AND f.sort_order = 0
    ORDER BY a.name ASC
  `).all()
  return rows.map(row => ({
    handle: row.handle,
    name: row.name,
    description: deriveDescription(row.body ?? ''),
    presets: parsePresets(row.presets_json).map(p => ({ slug: p.slug, name: p.name })),
  }))
}

function getAgentBody(db, handle) {
  const row = db.prepare(`SELECT id FROM agents WHERE handle = ?`).get(handle)
  if (!row) return null
  return readPrimaryBody(db, row.id)
}

function getAgentBodyWithPreset(db, handle, presetSlug) {
  const row = db.prepare(`SELECT id, presets_json FROM agents WHERE handle = ?`).get(handle)
  if (!row) return null
  const body = readPrimaryBody(db, row.id)
  if (body === null) return null
  const presets = parsePresets(row.presets_json)
  const preset = presets.find(p => p.slug === presetSlug)
  if (!preset) return null
  return substituteVariables(body, preset.values || {})
}

module.exports = { getCatalog, getAgentBody, getAgentBodyWithPreset }
