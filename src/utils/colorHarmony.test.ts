import { describe, it, expect } from 'vitest'
import { hexToHsl, hslToHex, applyHarmony, hashHandleToColor, type HarmonyMode } from './colorHarmony'

describe('hexToHsl / hslToHex', () => {
  it('round-trips pure red', () => {
    const hsl = hexToHsl('#ff0000')
    expect(hsl.h).toBe(0)
    expect(hsl.s).toBe(100)
    expect(hsl.l).toBe(50)
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe('#ff0000')
  })

  it('round-trips a non-trivial color (#6366f1, indigo-500)', () => {
    const hsl = hexToHsl('#6366f1')
    const back = hslToHex(hsl.h, hsl.s, hsl.l)
    expect(back.toLowerCase()).toBe('#6366f1')
  })

  it('handles white / black at HSL boundaries', () => {
    expect(hexToHsl('#ffffff').l).toBe(100)
    expect(hexToHsl('#000000').l).toBe(0)
  })

  it('hexToHsl accepts uppercase and missing #', () => {
    expect(hexToHsl('FF0000')).toEqual(hexToHsl('#ff0000'))
  })
})

describe('applyHarmony', () => {
  const base = '#6366f1'  // indigo

  it('complementary shifts hue by 180°', () => {
    const result = applyHarmony(base, 'complementary')
    const { h: bh } = hexToHsl(base)
    const { h: rh } = hexToHsl(result)
    expect(Math.abs(((rh - bh) + 360) % 360 - 180)).toBeLessThanOrEqual(1)
  })

  it('analogous shifts hue by 30°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'analogous'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(30, 0)
  })

  it('triadic shifts hue by 120°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'triadic'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(120, 0)
  })

  it('split-complementary shifts hue by 150°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'split'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(150, 0)
  })

  it('tetradic shifts hue by 90°', () => {
    const { h: rh } = hexToHsl(applyHarmony(base, 'tetradic'))
    const { h: bh } = hexToHsl(base)
    expect(((rh - bh) + 360) % 360).toBeCloseTo(90, 0)
  })

  it('monochromatic keeps hue + saturation, shifts lightness by +25 (clamped)', () => {
    const { h: bh, s: bs, l: bl } = hexToHsl(base)
    const { h: rh, s: rs, l: rl } = hexToHsl(applyHarmony(base, 'mono'))
    expect(rh).toBeCloseTo(bh, 0)
    // Saturation tolerance is wider (precision -1 ≈ ±5) because at high lightness
    // (~92%) 8-bit hex quantization fundamentally loses saturation precision on the
    // hex round-trip. The intent — preserve saturation approximately — is honored.
    expect(rs).toBeCloseTo(bs, -1)
    expect(rl).toBeCloseTo(Math.min(100, bl + 25), 0)
  })

  it('returns base unchanged for unknown harmony (defensive)', () => {
    const result = applyHarmony(base, 'unknown' as HarmonyMode)
    expect(result.toLowerCase()).toBe(base.toLowerCase())
  })
})

describe('hashHandleToColor', () => {
  it('returns the same color for the same handle', () => {
    expect(hashHandleToColor('reviewer')).toBe(hashHandleToColor('reviewer'))
  })

  it('different handles produce different hues', () => {
    const a = hashHandleToColor('reviewer')
    const b = hashHandleToColor('investigator')
    expect(a).not.toBe(b)
  })

  it('returns a valid hex string', () => {
    expect(hashHandleToColor('any-handle')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
