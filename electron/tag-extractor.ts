import { createLLMService } from './llm'
import { getDefault } from './store'
import type { ModelRef } from './llm/types'

const FALLBACK_TAG_MODEL: ModelRef = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }

function resolveTagModel(): ModelRef {
  const def = getDefault('tagExtract')
  if (!def) return FALLBACK_TAG_MODEL
  return def as ModelRef
}

export async function extractTags(
  query: string,
  knownTopics: string[],
): Promise<string[]> {
  const llm = createLLMService()
  const topicSample = knownTopics.slice(0, 300).join(', ')

  const prompt = `You are a GitHub repository search assistant. Extract search tags from the user's query.

Known GitHub topics (use these when they match): ${topicSample}

User query: "${query}"

Return ONLY a JSON array of 3-6 lowercase tags. Prefer exact matches from the known topics list. Include the programming language if mentioned. Add inferred synonyms if useful.

Examples:
"fast async HTTP client for Python" → ["http", "python", "async", "http-client", "requests"]
"render markdown in terminal" → ["markdown", "terminal", "cli", "renderer", "ansi"]
"small library to parse CSV files" → ["csv", "parser", "lightweight", "data"]

Return only the JSON array, nothing else.`

  try {
    const result = await llm.generateText(resolveTagModel(), {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
    })
    return JSON.parse(result.text.trim())
  } catch {
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)
  }
}
