// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockConnect, mockListTools, mockCallTool, mockClose, mockSpawn, mockTransport } = vi.hoisted(() => ({
  mockConnect:   vi.fn(),
  mockListTools: vi.fn(),
  mockCallTool:  vi.fn(),
  mockClose:     vi.fn(),
  mockSpawn:     vi.fn(),
  mockTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect:   mockConnect,
    listTools: mockListTools,
    callTool:  mockCallTool,
    close:     mockClose,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockTransport,
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/app' },
}))

import { getMcpClient, shutdownMcpClient } from './mcpClient'

beforeEach(async () => {
  // Reset the singleton between tests BEFORE clearing mock call counts,
  // so the close() triggered by a prior test's lingering client doesn't
  // pollute this test's counts.
  await shutdownMcpClient()

  mockConnect.mockReset()
  mockListTools.mockReset()
  mockCallTool.mockReset()
  mockClose.mockReset()
  mockTransport.mockClear()
  mockSpawn.mockClear()

  mockConnect.mockResolvedValue(undefined)
  mockListTools.mockResolvedValue({
    tools: [
      { name: 'list_skills', description: 'List all skills', inputSchema: { type: 'object' } },
      { name: 'get_skill',   description: 'Fetch skill body', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    ],
  })
  mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'tool output' }] })
})

describe('mcpClient', () => {
  it('lazily connects on first getMcpClient() call', async () => {
    expect(mockConnect).not.toHaveBeenCalled()
    await getMcpClient()
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockTransport).toHaveBeenCalledTimes(1)
  })

  it('returns the same instance on subsequent calls (no re-spawn)', async () => {
    const a = await getMcpClient()
    const b = await getMcpClient()
    expect(a).toBe(b)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('getTools() returns the listed tools mapped to McpTool[]', async () => {
    const client = await getMcpClient()
    const tools = await client.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({ name: 'list_skills', description: 'List all skills' })
    expect(typeof tools[0].execute).toBe('function')
  })

  it('callTool() executes via the underlying client', async () => {
    const client = await getMcpClient()
    await client.callTool('list_skills', { folderId: 1 })
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'list_skills', arguments: { folderId: 1 } })
  })

  it('shutdownMcpClient() closes the underlying client and clears the singleton', async () => {
    await getMcpClient()
    await shutdownMcpClient()
    expect(mockClose).toHaveBeenCalledTimes(1)
    // Re-acquire after shutdown spawns a new instance
    await getMcpClient()
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('a tool returned by getTools() executes via callTool when invoked', async () => {
    const client = await getMcpClient()
    const tools = await client.getTools()
    const result = await tools[0].execute({})
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'list_skills', arguments: {} })
    expect(result).toEqual({ content: [{ type: 'text', text: 'tool output' }] })
  })
})
