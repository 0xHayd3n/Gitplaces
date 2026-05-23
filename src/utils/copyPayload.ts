const DESCRIPTION_MAX = 200

export function deriveDescription(body: string): string {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    // Strip simple markdown formatting (bold, italic, code, links)
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
  handle: string             // without leading '@'
  description: string        // already trimmed; may be empty
  body: string
}

export function buildPersonaPayload(input: PersonaPayloadInput): string {
  const { handle, description, body } = input
  const framing = description.length > 0
    ? `You are @${handle}, ${stripTrailingPunct(description)}.`
    : `You are @${handle}.`
  return `${framing}\n\n${body}`
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, '')
}
