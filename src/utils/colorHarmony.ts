export type HarmonyMode =
  | 'manual'
  | 'mono'
  | 'analogous'
  | 'complementary'
  | 'split'
  | 'triadic'
  | 'tetradic'

export interface Hsl { h: number; s: number; l: number }

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace(/^#/, '').toLowerCase()
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360
  const ss = Math.max(0, Math.min(100, s)) / 100
  const ll = Math.max(0, Math.min(100, l)) / 100

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  let r: number, g: number, b: number
  if (ss === 0) {
    r = g = b = ll
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
    const p = 2 * ll - q
    r = hue2rgb(p, q, hh + 1 / 3)
    g = hue2rgb(p, q, hh)
    b = hue2rgb(p, q, hh - 1 / 3)
  }

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const HUE_SHIFT: Record<HarmonyMode, number | null> = {
  manual:         null,
  mono:           0,
  analogous:      30,
  complementary:  180,
  split:          150,
  triadic:        120,
  tetradic:       90,
}

export function applyHarmony(baseHex: string, mode: HarmonyMode): string {
  const shift = HUE_SHIFT[mode]
  if (shift === null || shift === undefined) return baseHex
  const { h, s, l } = hexToHsl(baseHex)
  if (mode === 'mono') {
    return hslToHex(h, s, Math.min(100, l + 25))
  }
  return hslToHex(h + shift, s, l)
}

// Deterministic default color for an agent given its handle (used by backfill
// and by the create flow as the initial swatch suggestion).
export function hashHandleToColor(handle: string): string {
  let hash = 5381
  for (let i = 0; i < handle.length; i++) {
    hash = ((hash << 5) + hash + handle.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 65, 55)
}
