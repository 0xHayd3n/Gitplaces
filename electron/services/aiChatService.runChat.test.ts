// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock sendMessageStream (the CLI path) and the in-app runner path.
const { mockSendMessageStream, mockLLMRunAgentLoop } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockLLMRunAgentLoop:   vi.fn(),
}))

vi.mock('./aiChatService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./aiChatService')>()
  return { ...mod, sendMessageStream: mockSendMessageStream }
})

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText:  vi.fn(),
    streamText:    vi.fn(),
    runAgentLoop:  mockLLMRunAgentLoop,
  })),
}))

vi.mock('../store', () => ({
  getDefault: vi.fn(),
}))

import { runChat } from './dispatchChat'

beforeEach(() => {
  mockSendMessageStream.mockReset()
  mockLLMRunAgentLoop.mockReset()
  mockSendMessageStream.mockResolvedValue(undefined)
})

describe('runChat — dispatcher', () => {
  it('routes anthropic to the CLI path (sendMessageStream)', async () => {
    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    }, callbacks)
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
    expect(mockLLMRunAgentLoop).not.toHaveBeenCalled()
  })

  it('routes opencode to the CLI path and passes the modelRef through', async () => {
    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'opencode', model: 'claude-sonnet-4-6' },
    }, callbacks)
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
    // sendMessageStream(messages, starredRepos, installedSkills, pageContext, modelRef, callbacks)
    const args = mockSendMessageStream.mock.calls[0]
    expect(args[4]).toEqual({ provider: 'opencode', model: 'claude-sonnet-4-6' })
  })

  it('routes openai to the in-app runner (llm.runAgentLoop)', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'text-delta', delta: 'gpt says hi' }
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(mockLLMRunAgentLoop).toHaveBeenCalledTimes(1)
    expect(mockSendMessageStream).not.toHaveBeenCalled()
    expect(callbacks.onToken).toHaveBeenCalledWith('gpt says hi')
    expect(callbacks.onDone).toHaveBeenCalledWith('gpt says hi')
  })

  it('falls back to chat default when no modelRef is provided', async () => {
    const storeMod = await import('../store')
    vi.mocked(storeMod.getDefault).mockReturnValue({ provider: 'openai', model: 'gpt-4o' })

    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
    }, callbacks)

    expect(mockLLMRunAgentLoop).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-4o' },
      expect.any(Object),
    )
  })

  it('forwards tool-call/tool-result events to onEvent', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'tool-call', id: 't1', name: 'list_skills', args: {} }
      yield { type: 'tool-result', id: 't1', result: { skills: [] }, isError: false }
      yield { type: 'text-delta', delta: 'done' }
      yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(callbacks.onEvent).toHaveBeenCalledTimes(2)
    expect(callbacks.onEvent.mock.calls[0][0]).toMatchObject({ type: 'tool-call', name: 'list_skills' })
    expect(callbacks.onEvent.mock.calls[1][0]).toMatchObject({ type: 'tool-result', id: 't1' })
  })

  it('forwards error events to onError', async () => {
    mockLLMRunAgentLoop.mockReturnValue((async function* () {
      yield { type: 'error', error: { kind: 'auth_invalid', message: 'bad key', name: 'LLMError' } }
    })())

    const callbacks = { onToken: vi.fn(), onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await runChat({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      starredRepos: [],
      installedSkills: [],
      modelRef: { provider: 'openai', model: 'gpt-4o' },
    }, callbacks)

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError.mock.calls[0][0]).toContain('bad key')
  })
})
