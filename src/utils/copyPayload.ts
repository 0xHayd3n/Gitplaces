import { substituteVariables } from './agentVariables'

const DESCRIPTION_MAX = 200

export function deriveDescription(body: string): string {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    const cleaned = trimmed
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    return cleaned.length > DESCRIPTION_MAX ? cleaned.slice(0, DESCRIPTION_MAX - 1) + '…' : cleaned
  }
  return ''
}

export interface PersonaPayloadInput {
  handle: string
  description: string
  body: string
  presetSlug?: string | null
  presetValues?: Record<string, string>
}

export function buildPersonaPayload(input: PersonaPayloadInput): string {
  const { handle, description, body, presetSlug, presetValues } = input
  const callable = presetSlug ? `${handle}/${presetSlug}` : handle
  const framing = description.length > 0
    ? `You are @${callable}, ${stripTrailingPunct(description)}.`
    : `You are @${callable}.`
  const substituted = presetValues ? substituteVariables(body, presetValues) : body
  return `${framing}\n\n${substituted}`
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, '')
}
