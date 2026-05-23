import { useEffect, useRef, useCallback } from 'react'

// ── Bayer 8x8 ordered dither matrix ──────────────────────────────
export const BAYER8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

// ── Color conversion utilities ───────────────────────────────────
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ]
}

// ── Cover-style aspect ratio correction ─────────────────────────
export function coverUV(
  u: number, v: number,
  imgW: number, imgH: number,
  outW: number, outH: number,
): { u: number; v: number } {
  const srcAspect = imgW / imgH
  const outAspect = outW / outH
  if (outAspect > srcAspect) {
    // Output is wider than source — compress v toward center
    v = 0.5 + (v - 0.5) * (srcAspect / outAspect)
  } else if (outAspect < srcAspect) {
    // Output is taller than source — compress u toward center
    u = 0.5 + (u - 0.5) * (outAspect / srcAspect)
  }
  return { u, v }
}

// ── Camera definitions ───────────────────────────────────────────
interface CameraSample { u: number; v: number }
interface Camera {
  name: string
  sample: (nx: number, ny: number, t: number) => CameraSample
}

const CAMERAS: Camera[] = [
  {
    name: 'straight',
    sample(nx, ny, t) {
      return {
        u: nx * 0.7 + 0.15 + Math.sin(t * 0.4) * 0.08,
        v: ny * 0.7 + 0.15 + Math.cos(t * 0.3) * 0.08,
      }
    },
  },
  {
    name: 'tightZoomA',
    sample(nx, ny, t) {
      return {
        u: 0.2 + Math.sin(t * 0.5) * 0.1 + nx * 0.3,
        v: 0.2 + Math.cos(t * 0.4) * 0.1 + ny * 0.3,
      }
    },
  },
  {
    name: 'tightZoomB',
    sample(nx, ny, t) {
      return {
        u: 0.5 + Math.cos(t * 0.45) * 0.1 + nx * 0.3,
        v: 0.5 + Math.sin(t * 0.55) * 0.1 + ny * 0.3,
      }
    },
  },
  {
    name: 'centered',
    sample(nx, ny, t) {
      const s = 0.85 + Math.sin(t * 0.8) * 0.02
      const o = (1 - s) / 2
      return { u: nx * s + o, v: ny * s + o }
    },
  },
]

const HOLD_DURATIONS = [360, 360, 360, 360]
const FADE_FRAMES = 24
const TOTAL_CYCLE = HOLD_DURATIONS.reduce((a, b) => a + b, 0)

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
}

// ── Dominant hue extraction ──────────────────────────────────────
function extractDominantHue(
  srcData: ImageData, imgW: number, imgH: number,
): { dominantHue: number; tintColor: [number, number, number] } {
  const cx = Math.floor(imgW / 2), cy = Math.floor(imgH / 2)
  const radius = Math.floor(Math.min(imgW, imgH) * 0.35)
  let hueSum = 0, satSum = 0, count = 0

  for (let y = cy - radius; y < cy + radius; y += 3) {
    for (let x = cx - radius; x < cx + radius; x += 3) {
      if (x < 0 || x >= imgW || y < 0 || y >= imgH) continue
      const i = (y * imgW + x) * 4
      const [h, s, l] = rgbToHsl(srcData.data[i], srcData.data[i + 1], srcData.data[i + 2])
      if (s > 0.15 && l > 0.1 && l < 0.9) {
        hueSum += h * s
        satSum += s
        count++
      }
    }
  }

  if (count === 0 || satSum < 0.1) {
    return { dominantHue: 0.75, tintColor: [220, 210, 235] }
  }

  const dominantHue = hueSum / satSum
  const tintHue = (dominantHue + 0.08) % 1.0
  const tintColor = hslToRgb(tintHue, 0.35, 0.88)
  return { dominantHue, tintColor }
}

// ── Per-frame camera rendering ───────────────────────────────────
function renderCamera(
  srcData: ImageData, imgW: number, imgH: number,
  w: number, h: number,
  camIdx: number, t: number,
  tintColor: [number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4)
  const data = srcData.data
  const camera = CAMERAS[camIdx]
  const [tR, tG, tB] = tintColor

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const raw = camera.sample(x / w, y / h, t)
      const { u, v } = coverUV(raw.u, raw.v, imgW, imgH, w, h)

      if (u < 0 || u > 1 || v < 0 || v > 1) {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255
        continue
      }

      // Bilinear sample
      const fx = u * (imgW - 1), fy = v * (imgH - 1)
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const x1 = Math.min(x0 + 1, imgW - 1), y1 = Math.min(y0 + 1, imgH - 1)
      const wx = fx - x0, wy = fy - y0

      const i00 = (y0 * imgW + x0) * 4
      const i10 = (y0 * imgW + x1) * 4
      const i01 = (y1 * imgW + x0) * 4
      const i11 = (y1 * imgW + x1) * 4

      const sr = data[i00] * (1 - wx) * (1 - wy) + data[i10] * wx * (1 - wy) + data[i01] * (1 - wx) * wy + data[i11] * wx * wy
      const sg = data[i00 + 1] * (1 - wx) * (1 - wy) + data[i10 + 1] * wx * (1 - wy) + data[i01 + 1] * (1 - wx) * wy + data[i11 + 1] * wx * wy
      const sb = data[i00 + 2] * (1 - wx) * (1 - wy) + data[i10 + 2] * wx * (1 - wy) + data[i01 + 2] * (1 - wx) * wy + data[i11 + 2] * wx * wy

      let [h2, s2, l2] = rgbToHsl(sr, sg, sb)
      const bayerVal = BAYER8[y % 8][x % 8] / 64

      // Light area protection: very bright → pure white
      if (l2 > 0.92) {
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255
        continue
      }

      // Light area: dither between white and complementary tint
      if (l2 > 0.7) {
        const lightFactor = (l2 - 0.7) / 0.22
        const threshold = lightFactor * 0.8 + 0.1
        if (bayerVal > threshold) {
          const colorBlend = 1.0 - lightFactor
          out[i]     = Math.round(tR * (1 - colorBlend * 0.3) + sr * colorBlend * 0.3)
          out[i + 1] = Math.round(tG * (1 - colorBlend * 0.3) + sg * colorBlend * 0.3)
          out[i + 2] = Math.round(tB * (1 - colorBlend * 0.3) + sb * colorBlend * 0.3)
          out[i + 3] = 255
        } else {
          out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255
        }
        continue
      }

      // Mid/dark areas: boost saturation + S-curve contrast + Bayer quantize
      s2 = Math.min(1, s2 * 2.0)
      const p = 2.0
      const lp = Math.pow(l2, p)
      l2 = lp / (lp + Math.pow(1 - l2, p))
      const [cr, cg, cb] = hslToRgb(h2, s2, l2)

      const levels = 6
      const rq = Math.floor((cr / 255 + (bayerVal - 0.5) / levels) * levels) / levels * 255
      const gq = Math.floor((cg / 255 + (bayerVal - 0.5) / levels) * levels) / levels * 255
      const bq = Math.floor((cb / 255 + (bayerVal - 0.5) / levels) * levels) / levels * 255

      out[i]     = Math.max(0, Math.min(255, rq))
      out[i + 1] = Math.max(0, Math.min(255, gq))
      out[i + 2] = Math.max(0, Math.min(255, bq))
      out[i + 3] = 255
    }
  }
  return out
}

// ── Scroll-pause hint ────────────────────────────────────────────
// Call setDitherScrollHint(true) when scroll starts and false when it settles.
// All active dither loops skip expensive rendering while scrolling, holding
// the last frame, then resume automatically.
let _scrolling = false
let _scrollTimer = 0

export function setDitherScrollHint(scrolling: boolean) {
  _scrolling = scrolling
  if (scrolling) {
    clearTimeout(_scrollTimer)
    _scrollTimer = window.setTimeout(() => { _scrolling = false }, 150)
  }
}

// ── Avatar source cache ──────────────────────────────────────────
// The expensive per-pixel work in extractDominantHue + renderCamera depends on
// (a) the decoded avatar's `ImageData` and (b) its dominant-hue derived tint
// color. Both are pure functions of the avatar URL. The Activities feed shows
// many BannerCards that all use the same owner avatar — caching the loaded +
// processed source eliminates N redundant image fetches, N getImageData
// allocations, and N extractDominantHue passes when N cards share a URL.
// The cache lives at module scope and persists across mounts; entries are
// trivial in size (a single avatar's pixel buffer + a 3-tuple).
//
// In-flight Promises are tracked separately so two cards mounting in the same
// tick share a single image load instead of racing.
interface AvatarSrcEntry {
  imgWidth: number
  imgHeight: number
  srcData: ImageData
  tintColor: [number, number, number]
}
const _avatarSrcCache = new Map<string, AvatarSrcEntry>()
const _avatarSrcInflight = new Map<string, Promise<AvatarSrcEntry | null>>()

// Static-frame output cache keyed by `${url}:${w}:${h}:${camIdx}`. With
// staticFrame=true the renderCamera call is deterministic (fixed camera, t=0),
// so the resulting ImageData is shared across every consumer that matches all
// four dimensions. Avoids the per-pixel render entirely on cache hit.
const _staticOutputCache = new Map<string, ImageData>()

// Most recently rendered banner dimensions (CSS pixels of the CONTAINER, not
// the scaled canvas). `prewarmStaticDither` reads this so it can pre-render at
// the same effective size useBayerDither will use when it mounts a moment
// later — keeping the prewarm and the mount on the same cache key.
let _lastBannerSize: { width: number; height: number } | null = null

// Pre-render and cache a static-frame dither for a given avatar + camera
// before any DitherBackground for it mounts. Used by the Library sidebar's
// click handler so the next route's banner paints in its first frame after
// mount instead of blinking in mid-crossfade.
export function prewarmStaticDither(avatarUrl: string | null | undefined, camIdx: number = 0): void {
  if (!avatarUrl || !_lastBannerSize) {
    if (avatarUrl) void loadAvatarSrc(avatarUrl)
    return
  }
  const scale = 0.25
  const w = Math.floor(_lastBannerSize.width * scale)
  const h = Math.floor(_lastBannerSize.height * scale)
  if (w <= 0 || h <= 0) return
  const outKey = `${avatarUrl}:${w}:${h}:${camIdx}`
  if (_staticOutputCache.has(outKey)) return
  void loadAvatarSrc(avatarUrl).then(entry => {
    if (!entry || _staticOutputCache.has(outKey)) return
    const pixels = renderCamera(entry.srcData, entry.imgWidth, entry.imgHeight, w, h, camIdx, 0, entry.tintColor)
    _staticOutputCache.set(outKey, new ImageData(pixels, w, h))
  })
}

function loadAvatarSrc(url: string): Promise<AvatarSrcEntry | null> {
  const cached = _avatarSrcCache.get(url)
  if (cached) return Promise.resolve(cached)
  const inflight = _avatarSrcInflight.get(url)
  if (inflight) return inflight

  const p = new Promise<AvatarSrcEntry | null>(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = img.width
      srcCanvas.height = img.height
      const srcCtx = srcCanvas.getContext('2d')
      if (!srcCtx) { resolve(null); return }
      srcCtx.drawImage(img, 0, 0)
      try {
        const srcData = srcCtx.getImageData(0, 0, img.width, img.height)
        const { tintColor } = extractDominantHue(srcData, img.width, img.height)
        const entry: AvatarSrcEntry = {
          imgWidth: img.width, imgHeight: img.height, srcData, tintColor,
        }
        _avatarSrcCache.set(url, entry)
        resolve(entry)
      } catch {
        // Canvas tainted by CORS — bail
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })

  _avatarSrcInflight.set(url, p)
  void p.finally(() => _avatarSrcInflight.delete(url))
  return p
}

// ── Hook ─────────────────────────────────────────────────────────
export function useBayerDither(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  avatarUrl: string | null | undefined,
  containerWidth: number,
  containerHeight: number,
  staticFrame = false,
  staticCameraIdx = 0,
) {
  const animRef = useRef<number>(0)
  const frameRef = useRef(0)
  const phaseRef = useRef(Math.floor(Math.random() * TOTAL_CYCLE))
  const visibleRef = useRef(true)
  const renderFnRef = useRef<((now: number) => void) | null>(null)

  const cleanup = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = 0
    }
  }, [])

  useEffect(() => {
    cleanup()
    if (!avatarUrl || !canvasRef.current || containerWidth <= 0 || containerHeight <= 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scale = 0.25
    const w = Math.floor(containerWidth * scale)
    const h = Math.floor(containerHeight * scale)
    canvas.width = w
    canvas.height = h

    _lastBannerSize = { width: containerWidth, height: containerHeight }

    let cancelled = false
    renderFnRef.current = null

    // Static-frame super-fast path: if we've already rendered this avatar at
    // the current size + camera, just blit the cached ImageData. No image
    // load, no extractDominantHue, no renderCamera, no IntersectionObserver.
    // Common case across the activity feed (every BannerCard shares the same
    // owner avatar + default camera).
    if (staticFrame) {
      const outKey = `${avatarUrl}:${w}:${h}:${staticCameraIdx}`
      const cachedOutput = _staticOutputCache.get(outKey)
      if (cachedOutput) {
        ctx.putImageData(cachedOutput, 0, 0)
        return () => { cancelled = true }
      }
    }

    // IntersectionObserver is only useful for animated mode (pause rAF when
    // off-screen, resume on re-enter). Static-frame renders once and stops,
    // so we skip the observer entirely on that path.
    let io: IntersectionObserver | null = null
    if (!staticFrame) {
      io = new IntersectionObserver(
        ([entry]) => {
          const wasHidden = !visibleRef.current
          visibleRef.current = entry.isIntersecting
          if (!entry.isIntersecting) {
            if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0 }
          } else if (wasHidden && !cancelled && renderFnRef.current && !animRef.current) {
            // Delay past any collapse/expand CSS transition (~260ms) before resuming
            // expensive rendering, so the transition isn't competing with renderCamera.
            setTimeout(() => {
              if (!cancelled && renderFnRef.current && visibleRef.current && !animRef.current) {
                animRef.current = requestAnimationFrame(renderFnRef.current)
              }
            }, 350)
          }
        },
        { threshold: 0 },
      )
      io.observe(canvas)
    }

    void loadAvatarSrc(avatarUrl).then(entry => {
      if (cancelled || !entry) return
      const { srcData, imgWidth: srcW, imgHeight: srcH, tintColor } = entry

      if (staticFrame) {
        // Render once at fixed camera/time, cache the output for sibling cards.
        // The cached ImageData's pixel buffer is shared by all consumers — do
        // NOT mutate `imageData.data` after caching, or every card sharing the
        // entry will see the mutation. `ctx.putImageData` only reads.
        const pixels = renderCamera(srcData, srcW, srcH, w, h, staticCameraIdx, 0, tintColor)
        const imageData = new ImageData(pixels, w, h)
        _staticOutputCache.set(`${avatarUrl}:${w}:${h}:${staticCameraIdx}`, imageData)
        ctx.putImageData(imageData, 0, 0)
        return
      }

      let lastRenderTime = 0
      const FRAME_INTERVAL = 66 // ~15fps

      function render(now: number) {
        if (cancelled) return
        if (!ctx) return
        if (!visibleRef.current) {
          // Stop the loop — IntersectionObserver will restart it when the card is visible again
          animRef.current = 0
          return
        }
        // Hold last frame during scroll — frees main thread for smooth input
        if (_scrolling) {
          animRef.current = requestAnimationFrame(render)
          return
        }
        // Throttle to ~15fps — dithered art doesn't need 60fps
        if (now - lastRenderTime < FRAME_INTERVAL) {
          animRef.current = requestAnimationFrame(render)
          return
        }
        lastRenderTime = now
        frameRef.current = (frameRef.current + 1) % (TOTAL_CYCLE * 1000)
        const t = frameRef.current * 0.003
        const cycleFrame = (frameRef.current + phaseRef.current) % TOTAL_CYCLE

        let accumulated = 0, currentCam = 0, frameInHold = 0
        for (let i = 0; i < CAMERAS.length; i++) {
          if (cycleFrame < accumulated + HOLD_DURATIONS[i]) {
            currentCam = i
            frameInHold = cycleFrame - accumulated
            break
          }
          accumulated += HOLD_DURATIONS[i]
        }

        const nextCam = (currentCam + 1) % CAMERAS.length
        const fadeStart = HOLD_DURATIONS[currentCam] - FADE_FRAMES
        const isFading = frameInHold >= fadeStart

        const currentPixels = renderCamera(
          srcData, srcW, srcH, w, h, currentCam, t, tintColor,
        )

        if (isFading) {
          const nextPixels = renderCamera(
            srcData, srcW, srcH, w, h, nextCam, t, tintColor,
          )
          const fadeProgress = easeOutCubic((frameInHold - fadeStart) / FADE_FRAMES)

          const final = new Uint8ClampedArray(w * h * 4)
          for (let i = 0; i < final.length; i += 4) {
            final[i]     = Math.floor(currentPixels[i]     * (1 - fadeProgress) + nextPixels[i]     * fadeProgress)
            final[i + 1] = Math.floor(currentPixels[i + 1] * (1 - fadeProgress) + nextPixels[i + 1] * fadeProgress)
            final[i + 2] = Math.floor(currentPixels[i + 2] * (1 - fadeProgress) + nextPixels[i + 2] * fadeProgress)
            final[i + 3] = 255
          }
          ctx.putImageData(new ImageData(final, w, h), 0, 0)
        } else {
          ctx.putImageData(new ImageData(currentPixels, w, h), 0, 0)
        }

        animRef.current = requestAnimationFrame(render)
      }

      renderFnRef.current = render
      if (visibleRef.current) {
        animRef.current = requestAnimationFrame(render)
      }
    })

    return () => {
      cancelled = true
      renderFnRef.current = null
      io?.disconnect()
      cleanup()
    }
  }, [avatarUrl, containerWidth, containerHeight, canvasRef, cleanup, staticFrame, staticCameraIdx])

  useEffect(() => {
    if (staticFrame) return
    function onVisChange() {
      if (document.visibilityState === 'hidden') {
        if (animRef.current) {
          cancelAnimationFrame(animRef.current)
          animRef.current = 0
        }
      } else if (visibleRef.current && renderFnRef.current && !animRef.current) {
        animRef.current = requestAnimationFrame(renderFnRef.current)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [staticFrame])
}
