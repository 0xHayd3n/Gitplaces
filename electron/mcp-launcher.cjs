#!/usr/bin/env node
// Standalone MCP server exposing Gitplaces agents as resources.
//
// Usage: node mcp-launcher.cjs <db-path>
//
// MCP clients (Claude Code, Cursor) launch this as a child process. It opens
// the SQLite DB read-only so it can coexist with a running Gitplaces app.

const Database = require('better-sqlite3')
const core = require('./mcp-launcher-core.cjs')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('Usage: node mcp-launcher.cjs <db-path>')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js')

const server = new Server(
  { name: 'gitplaces-agents', version: '0.1.0' },
  { capabilities: { resources: {} } },
)

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const catalog = core.getCatalog(db)
  const resources = []
  resources.push({
    uri: 'agent://',
    name: 'Catalog',
    description: 'Browse all available agents',
    mimeType: 'application/json',
  })
  for (const entry of catalog) {
    resources.push({
      uri: `agent://${entry.handle}`,
      name: `@${entry.handle}`,
      description: entry.description || entry.name,
      mimeType: 'text/markdown',
    })
    for (const preset of entry.presets) {
      resources.push({
        uri: `agent://${entry.handle}/${preset.slug}`,
        name: `@${entry.handle}/${preset.slug}`,
        description: `${entry.name} — ${preset.name} preset`,
        mimeType: 'text/markdown',
      })
    }
  }
  return { resources }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri

  if (uri === 'agent://') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(core.getCatalog(db), null, 2),
      }],
    }
  }

  const match = uri.match(/^agent:\/\/([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?$/)
  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`)
  }

  const handle = match[1]
  const presetSlug = match[2]

  const body = presetSlug
    ? core.getAgentBodyWithPreset(db, handle, presetSlug)
    : core.getAgentBody(db, handle)

  if (body === null) {
    throw new Error(`Resource not found: ${uri}`)
  }

  return {
    contents: [{ uri, mimeType: 'text/markdown', text: body }],
  }
})

const transport = new StdioServerTransport()
server.connect(transport).catch((err) => {
  console.error('MCP launcher failed to start:', err)
  process.exit(1)
})
