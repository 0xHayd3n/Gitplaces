import type { RepoType, ExtractionResult } from './types'
import { generateWithRawPrompt } from './legacy'

const TIMEOUT_MS = 10_000

function buildFocusPrompt(
  repoType: RepoType,
  extraction: ExtractionResult,
  readmeHead: string,
  typeBucket?: string,
  typeSub?: string,
): string {
  const ecosystem = extraction.manifest.ecosystem
  const exports = (extraction.exports ?? [])
    .slice(0, 20)
    .map(e => `${e.name} (${e.kind})`)
    .join(', ')

  const categoryLine = typeBucket && typeSub
    ? `\nCategory: ${typeBucket} / ${typeSub}`
    : typeBucket
      ? `\nCategory: ${typeBucket}`
      : typeSub
        ? `\nCategory: ${typeSub}`
        : ''

  return `You are analyzing a GitHub repository to guide skill file generation.

Repo type: ${repoType}${categoryLine}
Ecosystem: ${ecosystem}
Exports: ${exports || 'none extracted'}
README (first 2000 chars): ${readmeHead}

Based on this data, produce 3-5 bullet points describing what the skill file should emphasize for this SPECIFIC repo. Focus on:
- What kind of ${repoType} this actually is (e.g., "React hooks library for form validation")
- Which APIs or patterns matter most for someone using this in code
- Any domain-specific concepts the skill should explain
- What makes this different from a generic ${repoType}

Be concise. Each bullet should be one sentence. Output only the bullet points, nothing else.`
}

export async function inferFocusInstructions(
  repoType: RepoType,
  extraction: ExtractionResult,
  readmeHead: string,
  options: { typeBucket?: string; typeSub?: string },
): Promise<string | null> {
  // Skip when there's no useful signal
  if (
    repoType === 'generic' &&
    (!extraction.exports || extraction.exports.length === 0) &&
    !options.typeSub &&
    !options.typeBucket
  ) {
    return null
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const prompt = buildFocusPrompt(repoType, extraction, readmeHead, options.typeBucket, options.typeSub)
    const result = await Promise.race([
      generateWithRawPrompt(prompt, '', {
        model: 'claude-haiku-4-5',
        maxTokens: 200,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Focus inference timed out')), TIMEOUT_MS)
      }),
    ])
    return result.trim() || null
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
