import { describe, it, expect, beforeEach, vi } from 'vitest'
import { chooseRenderer, resetBundleCache } from './componentBundle'
import type { ComponentScanResult } from '../types/components'
import type { ParsedComponent } from './componentParser'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  resetBundleCache()
})

const reactComp: ParsedComponent = {
  path: 'src/Button.tsx', name: 'Button', props: [],
  framework: 'react', renderable: true,
}

const baseScan = (overrides: Partial<ComponentScanResult> = {}): ComponentScanResult => ({
  framework: 'react',
  pkg: { name: '@radix-ui/react-dialog', version: '1.0.5' },
  components: [{ path: reactComp.path, source: '' }],
  stories: [],
  error: null,
  ...overrides,
})

describe('chooseRenderer', () => {
  it('returns source tier when pkg is null', async () => {
    const result = await chooseRenderer(reactComp, baseScan({ pkg: null }))
    expect(result.tier).toBe('source')
  })

  it('returns source tier for vue framework even with pkg', async () => {
    const result = await chooseRenderer(
      { ...reactComp, framework: 'vue' },
      baseScan({ framework: 'vue' }),
    )
    expect(result.tier).toBe('source')
  })

  it('returns bundled tier when component name is exported', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button, Card }' })
      .mockResolvedValue({ ok: false, status: 404 })

    const result = await chooseRenderer(reactComp, baseScan())
    expect(result.tier).toBe('bundled')
    if (result.tier === 'bundled') {
      expect(result.render.exportName).toBe('Button')
      expect(result.render.importUrl).toContain('@radix-ui/react-dialog@1.0.5')
    }
  })

  it('returns source tier when component name is not exported', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => 'export { OtherThing }',
    })
    const result = await chooseRenderer(reactComp, baseScan())
    expect(result.tier).toBe('source')
  })

  it('caches export-list lookup across calls within same pkg', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button }' })
      .mockResolvedValue({ ok: false, status: 404 })

    await chooseRenderer(reactComp, baseScan())
    await chooseRenderer(reactComp, baseScan())

    const exportProbeCalls = fetchMock.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0] as string).includes('list-exports'),
    )
    expect(exportProbeCalls).toHaveLength(1)
  })

  it('dedups parallel calls for the same package (single export probe)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button }' })
      .mockResolvedValue({ ok: false, status: 404 })

    // 25 parallel calls → without dedup, would fire 25 export probes + 100 CSS probes
    await Promise.all(
      Array.from({ length: 25 }, () => chooseRenderer(reactComp, baseScan())),
    )

    const exportProbeCalls = fetchMock.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0] as string).includes('list-exports'),
    )
    expect(exportProbeCalls).toHaveLength(1)
  })

  it('returns bundled tier when exports list is empty (lenient — `export * from` re-export packages)', async () => {
    fetchMock
      // Export probe returns ONLY `export * from "..."` — our parser finds 0 names
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export * from "/v135/react-spinners@0.17.0/X.tsx"' })
      .mockResolvedValue({ ok: false, status: 404 })

    const result = await chooseRenderer(reactComp, baseScan())
    expect(result.tier).toBe('bundled')
  })

  it('includes CSS URLs that returned 200 from probe', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'export { Button }' })
      .mockResolvedValueOnce({ ok: false, status: 404 })  // /dist/style.css → miss
      .mockResolvedValueOnce({ ok: true,  status: 200 })  // /dist/index.css → hit
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await chooseRenderer(reactComp, baseScan())
    if (result.tier !== 'bundled') throw new Error('expected bundled')
    expect(result.render.cssUrls).toHaveLength(1)
    expect(result.render.cssUrls[0]).toContain('/dist/index.css')
  })
})
