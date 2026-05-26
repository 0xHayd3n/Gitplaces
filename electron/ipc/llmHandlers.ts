import { ipcMain } from 'electron'
import {
  getProviderConfig,
  setProviderConfig,
  listOpenAICompatibleEndpoints,
  upsertOpenAICompatibleEndpoint,
  removeOpenAICompatibleEndpoint,
  getDefault,
  setDefault,
  type DefaultFeature,
  type StoredModelRef,
} from '../store'
import { createLLMService, LLMError, type ModelRef, type ProviderId } from '../llm'

const KNOWN_PROVIDERS: readonly ProviderId[] = [
  'anthropic', 'openai', 'google', 'opencode', 'openai-compatible',
] as const

function assertKnownProvider(p: unknown): asserts p is ProviderId {
  if (typeof p !== 'string' || !(KNOWN_PROVIDERS as readonly string[]).includes(p)) {
    throw new Error(`Unknown provider: ${JSON.stringify(p)}`)
  }
}

const KNOWN_FEATURES: readonly DefaultFeature[] = ['chat', 'skillGen', 'tagExtract'] as const

function assertKnownFeature(f: unknown): asserts f is DefaultFeature {
  if (typeof f !== 'string' || !(KNOWN_FEATURES as readonly string[]).includes(f)) {
    throw new Error(`Unknown feature: ${JSON.stringify(f)}`)
  }
}

export function registerLLMHandlers(): void {
  // ── Providers ─────────────────────────────────────────────────────
  ipcMain.handle('llm:listProviders', async () => [...KNOWN_PROVIDERS])

  ipcMain.handle('llm:getProviderConfig', async (_event, provider: unknown) => {
    assertKnownProvider(provider)
    return getProviderConfig(provider)
  })

  ipcMain.handle('llm:setProviderConfig', async (_event, provider: unknown, cfg: unknown) => {
    assertKnownProvider(provider)
    if (typeof cfg !== 'object' || cfg === null) throw new Error('cfg must be an object')
    setProviderConfig(provider, cfg as Parameters<typeof setProviderConfig>[1])
  })

  // ── openai-compatible endpoints ───────────────────────────────────
  ipcMain.handle('llm:listOpenAICompatibleEndpoints', async () => listOpenAICompatibleEndpoints())

  ipcMain.handle('llm:upsertOpenAICompatibleEndpoint', async (_event, ep: unknown) => {
    if (typeof ep !== 'object' || ep === null) throw new Error('endpoint must be an object')
    upsertOpenAICompatibleEndpoint(ep as Parameters<typeof upsertOpenAICompatibleEndpoint>[0])
  })

  ipcMain.handle('llm:removeOpenAICompatibleEndpoint', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id must be a string')
    removeOpenAICompatibleEndpoint(id)
  })

  // ── Defaults ──────────────────────────────────────────────────────
  ipcMain.handle('llm:getDefault', async (_event, feature: unknown) => {
    assertKnownFeature(feature)
    return getDefault(feature)
  })

  ipcMain.handle('llm:setDefault', async (_event, feature: unknown, ref: unknown) => {
    assertKnownFeature(feature)
    if (typeof ref !== 'object' || ref === null) throw new Error('ref must be an object')
    setDefault(feature, ref as StoredModelRef)
  })

  // ── Test connection ───────────────────────────────────────────────
  ipcMain.handle('llm:testConnection', async (_event, ref: unknown) => {
    if (typeof ref !== 'object' || ref === null) throw new Error('ref must be an object')
    const modelRef = ref as ModelRef
    try {
      const llm = createLLMService()
      const result = await llm.generateText(modelRef, {
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 8,
      })
      return { ok: true, sample: result.text.slice(0, 80) }
    } catch (err) {
      if (err instanceof LLMError) {
        return { ok: false, kind: err.kind, message: err.message }
      }
      return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
    }
  })
}
