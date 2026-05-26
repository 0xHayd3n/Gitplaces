import { getMcpClient } from './mcpClient'
import { LLMError } from './types'
import type { AgentEvent, LLMCallOpts, McpTool, ModelRef } from './types'

interface AdapterLike {
  runAgentLoop(ref: ModelRef, opts: LLMCallOpts): AsyncIterable<AgentEvent>
}

/**
 * Wraps an adapter's runAgentLoop with auto-injected MCP tools.
 *
 * Tool resolution rules:
 * - opts.tools is undefined → fetch tools from MCP and inject
 * - opts.tools is [] → use [] (caller explicitly disabled tools)
 * - opts.tools is non-empty → use as-is (caller provided custom tools)
 */
export async function* runAgentLoop(
  adapter: AdapterLike,
  ref: ModelRef,
  opts: LLMCallOpts,
): AsyncIterable<AgentEvent> {
  let tools: McpTool[] | undefined = opts.tools
  if (tools === undefined) {
    try {
      const client = await getMcpClient()
      tools = await client.getTools()
    } catch (err) {
      yield {
        type: 'error',
        error: new LLMError('tool_failed', err instanceof Error ? err.message : String(err), err),
      }
      return
    }
  }
  yield* adapter.runAgentLoop(ref, { ...opts, tools })
}
