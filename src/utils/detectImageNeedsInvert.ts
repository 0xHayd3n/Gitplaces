const SAMPLE_SIZE = 64
const CORNER_SIZE = 8
const DARK_THRESHOLD = 80
const LIGHT_THRESHOLD = 200
const DARK_RATIO_MIN = 0.25
const CORNER_LIGHT_MIN = 0.5
const SATURATION_PROXY_MAX = 30

export function detectImageNeedsInvert(img: HTMLImageElement): boolean {
  if (img.naturalWidth < 32 || img.naturalHeight < 32) return false

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    let darkCount = 0
    let totalOpaque = 0
    let saturationProxySum = 0

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 128) continue
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      totalOpaque++
      if (lum < DARK_THRESHOLD) darkCount++
      saturationProxySum += Math.max(Math.abs(r - lum), Math.abs(g - lum), Math.abs(b - lum))
    }

    if (totalOpaque === 0) return false

    const darkRatio = darkCount / totalOpaque
    const avgSaturationProxy = saturationProxySum / totalOpaque
    if (avgSaturationProxy > SATURATION_PROXY_MAX) return false

    // Check the four corner regions for light/transparent background
    let cornerLightTotal = 0
    const corners = [
      [0, 0],
      [SAMPLE_SIZE - CORNER_SIZE, 0],
      [0, SAMPLE_SIZE - CORNER_SIZE],
      [SAMPLE_SIZE - CORNER_SIZE, SAMPLE_SIZE - CORNER_SIZE],
    ]
    for (const [ox, oy] of corners) {
      let lightInRegion = 0
      const regionSize = CORNER_SIZE * CORNER_SIZE
      for (let y = oy; y < oy + CORNER_SIZE; y++) {
        for (let x = ox; x < ox + CORNER_SIZE; x++) {
          const idx = (y * SAMPLE_SIZE + x) * 4
          const a = data[idx + 3]
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          if (a < 128 || lum > LIGHT_THRESHOLD) lightInRegion++
        }
      }
      cornerLightTotal += lightInRegion / regionSize
    }
    const cornerLightRatio = cornerLightTotal / corners.length

    return darkRatio > DARK_RATIO_MIN && cornerLightRatio > CORNER_LIGHT_MIN
  } catch {
    return false
  }
}
