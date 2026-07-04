/**
 * Avatar dominant-colour extraction for the Electron main process.
 * Uses Electron's built-in nativeImage — no additional native dependencies.
 */
import { nativeImage } from 'electron'
import https from 'https'
import http from 'http'

export interface HSL { h: number; s: number; l: number }

const FALLBACK: HSL = { h: 220, s: 0.25, l: 0.18 }

/** Fetch a remote URL as a Buffer, following up to 5 redirects. */
function fetchBuffer(url: string, redirectsLeft = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
    const mod = url.startsWith('https') ? https : http
    mod.get(url, { headers: { 'User-Agent': 'Gitplaces/1.0' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(fetchBuffer(res.headers.location, redirectsLeft - 1))
        return
      }
      if (res.statusCode && res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h: h * 360, s, l }
}

/**
 * Fetch an avatar image, sample pixels at 16×16 resolution, and return
 * the dominant hue as an HSL object suitable for deriveBannerPalette().
 * Falls back to a neutral dark blue on any error.
 */
export async function extractDominantColor(imageUrl: string): Promise<HSL> {
  try {
    const buf = await fetchBuffer(imageUrl)
    const img = nativeImage.createFromBuffer(buf)
    const { width, height } = img.getSize()
    if (!width || !height) return FALLBACK

    // Downsample to 16×16 for fast pixel sampling
    const small = img.resize({ width: 16, height: 16 })
    const data   = small.getBitmap()  // RGBA, 4 bytes per pixel

    const pixels: HSL[] = []
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]     / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const a = data[i + 3] / 255
      if (a < 0.5)   continue   // transparent
      const hsl = rgbToHsl(r, g, b)
      if (hsl.l > 0.88) continue  // near-white
      if (hsl.l < 0.06) continue  // near-black (dark backgrounds)
      if (hsl.s < 0.12) continue  // near-grey
      pixels.push(hsl)
    }

    if (pixels.length === 0) return FALLBACK

    // Chroma-weighted circular mean for hue.
    // Chroma = s * (1 - |2L - 1|) measures perceived colourfulness: a dark blue pixel
    // (l=0.1, s=0.8) has high saturation but low chroma (0.16) because it looks near-black,
    // while a vivid red pixel (l=0.5, s=0.9) has high chroma (0.9). This ensures the
    // bright, colourful parts of an icon dominate over dark/light backgrounds.
    let sinSum = 0, cosSum = 0, satSum = 0
    for (const p of pixels) {
      const rad = (p.h * Math.PI) / 180
      const chroma = p.s * (1 - Math.abs(2 * p.l - 1))
      sinSum  += Math.sin(rad) * chroma
      cosSum  += Math.cos(rad) * chroma
      satSum  += p.s
    }

    return {
      h: Math.round(((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360),
      s: Math.min(Math.max(satSum / pixels.length, 0.3), 0.9),
      l: 0.18,
    }
  } catch {
    return FALLBACK
  }
}

/**
 * Derive a full banner colour palette from the dominant HSL.
 * Kept here as well as src/utils/color.ts so the main process never imports renderer code.
 */
export function deriveBannerPalette(dominant: HSL) {
  const { h, s } = dominant
  return {
    bg:             `hsl(${h}, ${Math.round(s * 30)}%, 6%)`,
    gradientCenter: `hsl(${h}, ${Math.round(s * 60)}%, 14%)`,
    primary:        `hsl(${h}, ${Math.round(s * 80)}%, 55%)`,
    secondary:      `hsl(${h}, ${Math.round(s * 70)}%, 70%)`,
    textFaint:      `hsl(${h}, ${Math.round(s * 40)}%, 25%)`,
  }
}
