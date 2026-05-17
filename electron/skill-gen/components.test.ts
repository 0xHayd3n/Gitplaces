import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateComponents, type ComponentsInput } from './components'

vi.mock('./github-files', () => ({
  fetchFileTree: vi.fn(async () => ['src/Button.tsx']),
  fetchRepoFiles: vi.fn(async () => new Map<string, string>()),
  fetchManifest: vi.fn(async () => ({ filename: 'package.json', content: '{"name":"ui"}' })),
}))
vi.mock('./manifest-parser', () => ({ parseManifest: () => ({ ecosystem: 'node', name: 'ui' }) }))
vi.mock('./legacy', () => ({ generateWithRawPrompt: vi.fn(async () => '## [COMPONENTS]\n### Button') }))
vi.mock('./focus-inference', () => ({ inferFocusInstructions: vi.fn(async () => null) }))

const input: ComponentsInput = {
  token: 't', owner: 'o', name: 'n', language: 'TypeScript', topics: [], readme: 'R',
  version: 'v1', defaultBranch: 'main',
  scannedComponents: [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }],
}

describe('generateComponents (slim)', () => {
  it('returns validated [COMPONENTS] content via the component-library extractor', async () => {
    const r = await generateComponents(input)
    expect(r.content).toContain('## [COMPONENTS]')
    expect(r.validation).toBeDefined()
  })

  it('does not import the extractor/template barrels, classifier, pipeline, or prompts', () => {
    const src = readFileSync('electron/skill-gen/components.ts', 'utf8')
    // Assert no IMPORT of those modules (comment prose may name them).
    expect(src).not.toMatch(/from\s+['"]\.\/(extractors\/index|templates\/index|classifier|pipeline|prompts)['"]/)
    expect(src).not.toMatch(/import\(\s*['"]\.\/(extractors\/index|templates\/index|classifier|pipeline|prompts)['"]/)
  })
})
