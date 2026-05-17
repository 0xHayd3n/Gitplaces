import { describe, it, expect } from 'vitest'
import { buildComponentsPrompt } from './components-prompt'
import type { ExtractionResult } from './types'

const extraction: ExtractionResult = {
  repoType: 'component-library', manifest: { ecosystem: 'node', name: 'ui' }, fileTree: [],
  components: [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }],
}

describe('buildComponentsPrompt (lifted, barrel-free)', () => {
  it('emits the [COMPONENTS] format and includes scanned component names', () => {
    const p = buildComponentsPrompt(extraction, 'README', 'o/n', null,
      [{ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }])
    expect(p).toContain('## [COMPONENTS]')
    expect(p).toContain('Button')
    expect(p).toContain('o/n')
  })
})
