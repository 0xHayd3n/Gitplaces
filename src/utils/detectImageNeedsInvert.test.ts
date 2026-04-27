import { describe, it, expect, beforeEach, vi } from 'vitest'
import { detectImageNeedsInvert } from './detectImageNeedsInvert'

// Helper: build a fake HTMLImageElement with a canvas mock that returns synthetic pixel data
function makeImg(
  width: number,
  height: number,
  fillFn: (data: Uint8ClampedArray, w: number, h: number) => void
): { img: HTMLImageElement; setupMock: () => void } {
  const img = { naturalWidth: width, naturalHeight: height } as HTMLImageElement

  const setupMock = () => {
    vi.spyOn(document, 'createElement').mockImplementationOnce((tag) => {
      if (tag !== 'canvas') return document.createElement(tag)

      // Return a fully mocked canvas object
      const SIZE = 64
      let pixelData: Uint8ClampedArray | null = null

      const mockCanvas = {
        width: SIZE,
        height: SIZE,
        getContext(type: string) {
          if (type !== '2d') return null
          return {
            drawImage() {
              // Populate pixel data when drawImage is called
              pixelData = new Uint8ClampedArray(SIZE * SIZE * 4)
              fillFn(pixelData, SIZE, SIZE)
            },
            createImageData(width: number, height: number) {
              return new ImageData(width, height)
            },
            putImageData(imageData: ImageData) {
              pixelData = imageData.data
            },
            getImageData(x: number, y: number, w: number, h: number) {
              if (!pixelData) {
                pixelData = new Uint8ClampedArray(SIZE * SIZE * 4)
                fillFn(pixelData, SIZE, SIZE)
              }
              return { data: pixelData }
            },
          } as any
        },
      } as any

      return mockCanvas
    })
  }

  return { img, setupMock }
}

// Fill entire canvas with a solid RGBA colour
function solidFill(r: number, g: number, b: number, a: number) {
  return (data: Uint8ClampedArray) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a
    }
  }
}

// Fill corners with colour A and the rest with colour B
function cornerFill(
  cornerR: number, cornerG: number, cornerB: number, cornerA: number,
  fillR: number,   fillG: number,   fillB: number,   fillA: number,
  cornerSize = 8
) {
  return (data: Uint8ClampedArray, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const inCorner =
          (x < cornerSize && y < cornerSize) ||
          (x >= w - cornerSize && y < cornerSize) ||
          (x < cornerSize && y >= h - cornerSize) ||
          (x >= w - cornerSize && y >= h - cornerSize)
        if (inCorner) {
          data[idx] = cornerR; data[idx+1] = cornerG; data[idx+2] = cornerB; data[idx+3] = cornerA
        } else {
          data[idx] = fillR; data[idx+1] = fillG; data[idx+2] = fillB; data[idx+3] = fillA
        }
      }
    }
  }
}

describe('detectImageNeedsInvert', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns false for images smaller than 32px', () => {
    const img = { naturalWidth: 16, naturalHeight: 16 } as HTMLImageElement
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns true for black-on-white image (classic dark logo on light background)', () => {
    // Corners: white (255,255,255,255), interior: black (0,0,0,255)
    const { img, setupMock } = makeImg(64, 64, cornerFill(255,255,255,255, 0,0,0,255))
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(true)
  })

  it('returns true for black-on-transparent image (logo with transparent background)', () => {
    // Corners: fully transparent, interior: black
    const { img, setupMock } = makeImg(64, 64, cornerFill(0,0,0,0, 0,0,0,255))
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(true)
  })

  it('returns false for white-on-dark image (already readable, no inversion needed)', () => {
    // Corners: black (dark bg), interior: white text
    const { img, setupMock } = makeImg(64, 64, cornerFill(0,0,0,255, 255,255,255,255))
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a solid white image (nothing to invert)', () => {
    const { img, setupMock } = makeImg(64, 64, solidFill(255, 255, 255, 255))
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a solid black image (all-dark: no light background → not a logo)', () => {
    const { img, setupMock } = makeImg(64, 64, solidFill(0, 0, 0, 255))
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false for a colourful image (high colour variance = photograph)', () => {
    // Fill with high-variance colour data: alternating vivid red and vivid blue
    const { img, setupMock } = makeImg(64, 64, (data) => {
      for (let i = 0; i < data.length; i += 4) {
        const isEven = (i / 4) % 2 === 0
        data[i]   = isEven ? 220 : 30
        data[i+1] = isEven ? 30  : 30
        data[i+2] = isEven ? 30  : 220
        data[i+3] = 255
      }
    })
    setupMock()
    expect(detectImageNeedsInvert(img)).toBe(false)
  })

  it('returns false when canvas throws (CORS tainted)', () => {
    const img = { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => {
      throw new Error('Tainted canvas')
    })
    expect(detectImageNeedsInvert(img)).toBe(false)
  })
})
