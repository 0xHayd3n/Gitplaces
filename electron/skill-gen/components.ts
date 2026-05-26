// Slim, barrel-free components-sub-skill generator (D12 retained path).
// Replaces the deleted legacy component generation. Imports only the
// component-library extractor + the lifted prompt + minimal shared leaves —
// never the deleted extractor/template barrels or master pipeline.
import { fetchFileTree, fetchRepoFiles, fetchManifest } from './github-files'
import { parseManifest } from './manifest-parser'
import { componentLibraryExtractor } from './extractors/component-library'
import { buildComponentsPrompt } from './components-prompt'
import { inferFocusInstructions } from './focus-inference'
import { validateComponents } from './validator'
import { generateWithRawPrompt } from './legacy'
import { extractionCache } from './extraction-cache'
import type { ExtractionResult, ManifestInfo, ValidationResult } from './types'

export interface ComponentsInput {
  token: string | null
  owner: string
  name: string
  language: string
  topics: string[]
  readme: string
  version: string
  defaultBranch: string
  typeBucket?: string
  typeSub?: string
  scannedComponents?: Array<{ name: string; props: Array<{ name: string; type: string; required: boolean; defaultValue?: string }> }>
}

async function extract(input: ComponentsInput): Promise<ExtractionResult> {
  const { token, owner, name, defaultBranch } = input
  const fallback: ExtractionResult = { repoType: 'component-library', manifest: { ecosystem: 'unknown' }, fileTree: [] }
  if (!token) return fallback
  const cacheKey = `components:${owner}/${name}@${defaultBranch}`
  const cached = extractionCache.get(cacheKey)
  if (cached) return cached.extraction
  try {
    const fileTree = await fetchFileTree(token, owner, name, defaultBranch)
    const manifestResult = await fetchManifest(token, owner, name, fileTree)
    let manifest: ManifestInfo = { ecosystem: 'unknown' }
    if (manifestResult) manifest = parseManifest(manifestResult.filename, manifestResult.content)
    const filesToFetch = componentLibraryExtractor.getFilesToFetch(fileTree, manifest)
    const files = await fetchRepoFiles(token, owner, name, filesToFetch)
    const extracted = componentLibraryExtractor.extract(files, manifest)
    const extraction: ExtractionResult = { repoType: 'component-library', manifest, fileTree, ...extracted }
    extractionCache.set(cacheKey, { extraction, repoType: 'component-library' })
    return extraction
  } catch (err) {
    console.error('[components] extraction failed, using fallback:', err)
    return fallback
  }
}

export async function generateComponents(
  input: ComponentsInput,
): Promise<{ content: string; validation: ValidationResult }> {
  const repoFullName = `${input.owner}/${input.name}`
  const extraction = await extract(input)

  let focus: string | null = null
  try {
    focus = await inferFocusInstructions('component-library', extraction, input.readme.slice(0, 2000),
      { typeBucket: input.typeBucket, typeSub: input.typeSub })
  } catch (err) {
    console.error('[components] focus inference failed, continuing:', err)
  }

  const prompt = buildComponentsPrompt(extraction, input.readme, repoFullName, focus, input.scannedComponents)
  const raw = await generateWithRawPrompt(prompt, input.readme, {
    model: 'claude-haiku-4-5', maxTokens: 4096,
  })
  const { content, result } = validateComponents(raw, input.readme)
  return { content, validation: result }
}
