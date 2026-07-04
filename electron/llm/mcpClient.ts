import { app } from 'electron'
import * as path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpTool } from './types'

export interface McpClientHandle {
  getTools(): Promise<McpTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

let singleton: McpClientHandle | undefined
let rawClient: Client | undefined
let inflight: Promise<McpClientHandle> | undefined

/**
 * Returns the singleton MCP client, connecting on first call.
 *
 * The MCP server runs as a dedicated subprocess separate from the
 * Electron-spawned one in main.ts — stdio is inherently single-client,
 * and the server is cheap (read-only DB + fs), so a duplicate process
 * is simpler than multiplexing.
 */
export async function getMcpClient(): Promise<McpClientHandle> {
  if (singleton) return singleton
  if (inflight) return inflight

  inflight = (async () => {
    const mcpScript = path.join(app.getAppPath(), 'dist-electron', 'mcp-server.js')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpScript],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string>,
    })

    const client = new Client(
      { name: 'gitplaces-in-app-runner', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)
    rawClient = client

    const handle: McpClientHandle = {
      async getTools(): Promise<McpTool[]> {
        const response = await client.listTools()
        return response.tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
          execute: (args: Record<string, unknown>) => client.callTool({ name: t.name, arguments: args }),
        }))
      },
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return client.callTool({ name, arguments: args })
      },
    }

    singleton = handle
    return handle
  })()

  try {
    return await inflight
  } finally {
    inflight = undefined
  }
}

/**
 * Closes the MCP client + underlying subprocess. Call from app cleanup.
 * Safe to call multiple times.
 */
export async function shutdownMcpClient(): Promise<void> {
  const client = rawClient
  singleton = undefined
  rawClient = undefined
  if (client) {
    try {
      await client.close()
    } catch {
      // Best-effort close — subprocess may already be dead.
    }
  }
}
