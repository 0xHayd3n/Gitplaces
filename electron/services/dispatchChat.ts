import { sendMessageStream, buildSystemPrompt } from './aiChatService'
import type { AiChatMessage } from './aiChatService'
import { createLLMService } from '../llm'
import { getDefault } from '../store'
import type { AgentEvent, ModelRef } from '../llm/types'

export interface RunChatRequest {
  messages: AiChatMessage[]
  starredRepos: string[]
  installedSkills: string[]
  pageContext?: string
  /** Agent id from the agents table, or null for "quick chat" mode. */
  agentId?: string | null
  /** Optional explicit model. Falls back to settings.defaults.chat or sonnet-4-6. */
  modelRef?: ModelRef
}

export interface RunChatCallbacks {
  onToken(token: string): void
  onEvent(event: AgentEvent): void
  onDone(fullText: string): void
  onError(error: string): void
}

const FALLBACK_CHAT_MODEL: ModelRef = { provider: 'anthropic', model: 'claude-sonnet-4-6' }

function resolveChatModel(req: RunChatRequest): ModelRef {
  if (req.modelRef) return req.modelRef
  const def = getDefault('chat')
  if (def) return def as ModelRef
  return FALLBACK_CHAT_MODEL
}

/**
 * Top-level chat dispatcher. Branches on the resolved model's provider:
 *   - anthropic / opencode → Claude Code (or OpenCode in Phase 6) CLI subprocess
 *   - openai / google / openai-compatible → in-app runner via electron/llm/
 *
 * Callbacks bridge the unified surface to whichever path runs. Token + done
 * fire on both paths; events + error are runner-specific (CLI surfaces errors
 * via onError too).
 */
export async function runChat(req: RunChatRequest, callbacks: RunChatCallbacks): Promise<void> {
  const ref = resolveChatModel(req)

  if (ref.provider === 'anthropic' || ref.provider === 'opencode') {
    return sendMessageStream(
      req.messages,
      req.starredRepos,
      req.installedSkills,
      req.pageContext,
      ref,
      {
        onToken: callbacks.onToken,
        onDone:  callbacks.onDone,
        onError: callbacks.onError,
      },
    )
  }

  const llm = createLLMService()
  const systemPrompt = buildSystemPrompt(req.starredRepos, req.installedSkills, req.pageContext)
  const messages = req.messages.map(m => ({ role: m.role, content: m.content }))

  let acc = ''
  try {
    for await (const event of llm.runAgentLoop(ref, {
      systemPrompt,
      messages,
    })) {
      switch (event.type) {
        case 'text-delta':
          acc += event.delta
          callbacks.onToken(event.delta)
          break
        case 'tool-call':
        case 'tool-result':
          callbacks.onEvent(event)
          break
        case 'done':
          callbacks.onDone(acc)
          return
        case 'error':
          callbacks.onError(event.error.message ?? 'Unknown LLM error')
          return
      }
    }
    callbacks.onDone(acc)
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}
