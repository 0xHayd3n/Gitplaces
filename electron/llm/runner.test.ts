// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockGetTools } = vi.hoisted(() => ({ mockGetTools: vi.fn() }))

vi.mock('./mcpClient', () => ({
  getMcpClient: vi.fn(async () => ({
    getTools: mockGetTools,
    callTool: vi.fn(),
  })),
}))

import { runAgentLoop } from './runner'

beforeEach(() => {
  mockGetTools.mockReset()
  mockGetTools.mockResolvedValue([
    { name: 'list_skills', description: 'List skills', inputSchema: { type: 'object' }, execute: vi.fn() },
  ])
})

describe('runAgentLoop', () => {
  it('auto-injects MCP tools when opts.tools is undefined', async () => {
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toHaveLength(1)
      expect(opts.tools[0].name).toBe('list_skills')
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'claude-sonnet-4-6' }, { messages: [] })) {
      events.push(ev)
    }
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
  })

  it('passes through opts.tools when caller provided them (no MCP fetch)', async () => {
    const userTools = [{ name: 'custom', description: 'x', inputSchema: { type: 'object' }, execute: vi.fn() }]
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toBe(userTools)
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [], tools: userTools })) {
      events.push(ev)
    }
    expect(mockGetTools).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('passes through opts.tools = [] explicitly as "no tools" (no MCP fetch)', async () => {
    const mockAdapterRun = vi.fn(async function* (_ref: any, opts: any) {
      expect(opts.tools).toEqual([])
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })
    const adapter = { runAgentLoop: mockAdapterRun, streamText: vi.fn(), generateText: vi.fn() }

    for await (const _ of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [], tools: [] })) {}
    expect(mockGetTools).not.toHaveBeenCalled()
  })

  it('emits an error event if MCP getTools fails', async () => {
    mockGetTools.mockRejectedValue(new Error('mcp dead'))
    const adapter = { runAgentLoop: vi.fn(), streamText: vi.fn(), generateText: vi.fn() }

    const events: any[] = []
    for await (const ev of runAgentLoop(adapter as any, { provider: 'anthropic', model: 'x' }, { messages: [] })) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect(events[0].error.message).toContain('mcp dead')
  })
})
