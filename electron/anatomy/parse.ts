// electron/anatomy/parse.ts
import { parse as parseToml } from 'smol-toml'
import type { AnatomyModel, MemoryEntry } from './types'

export function parseAnatomy(toml: string): AnatomyModel {
  let raw: Record<string, unknown>
  try {
    raw = parseToml(toml) as Record<string, unknown>
  } catch (err) {
    throw new Error(`anatomy parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const rules = Array.isArray(raw.rules) ? (raw.rules as AnatomyModel['rules']) : []
  const decisions = Array.isArray(raw.decisions) ? (raw.decisions as AnatomyModel['decisions']) : []
  return {
    identity: (raw.identity as AnatomyModel['identity']) ?? {},
    generated: (raw.generated as AnatomyModel['generated']) ?? {},
    operation: raw.operation as Record<string, unknown> | undefined,
    substance: raw.substance as Record<string, unknown> | undefined,
    rules,
    decisions,
  }
}

export function parseMemory(toml: string | null): MemoryEntry[] {
  if (!toml) return []
  try {
    const raw = parseToml(toml) as Record<string, unknown>
    return Array.isArray(raw.entries) ? (raw.entries as MemoryEntry[]) : []
  } catch (err) {
    throw new Error(`anatomy memory parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
