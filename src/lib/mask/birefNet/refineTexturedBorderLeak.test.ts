import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import { refineTexturedBorderLeak } from './refineTexturedBorderLeak'

function makeImage(
  w: number,
  h: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return new ImageData(data, w, h)
}

function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

/** Checkerboard texture ≈ carpet variance. */
function paintCarpet(image: ImageData, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const lit = (x + y) % 2 === 0
      setRgb(image, x, y, lit ? [190, 180, 165] : [160, 150, 138])
    }
  }
}

describe('refineTexturedBorderLeak', () => {
  it('does not mutate source RGB and peels textured border KEEP', () => {
    const w = 64
    const h = 64
    const img = makeImage(w, h, [246, 246, 246])
    paintCarpet(img, 0, 0, w, h)
    const mask = createMaskBuffer(w, h, 0)
    // Sparse carpet KEEP on the top edge only (<<10% of garment KEEP)
    for (let x = 8; x < 24; x += 1) {
      mask.data[x] = 255
      mask.data[w + x] = 255
    }
    // White garment island in the center (KEEP)
    for (let y = 12; y < 52; y += 1) {
      for (let x = 12; x < 52; x += 1) {
        setRgb(img, x, y, [244, 244, 242])
        mask.data[y * w + x] = 255
      }
    }
    const rgbBefore = Uint8ClampedArray.from(img.data)
    const result = refineTexturedBorderLeak(mask, img)
    expect(Array.from(img.data)).toEqual(Array.from(rgbBefore))
    expect(result.applied).toBe(true)
    expect(result.stripped).toBeGreaterThan(8)
    // Center garment must remain KEEP
    expect(result.mask.data[32 * w + 32]).toBeGreaterThanOrEqual(128)
  })

  it('preserves thin dark measuring-tape-like KEEP', () => {
    const w = 80
    const h = 40
    const img = makeImage(w, h, [200, 190, 175])
    paintCarpet(img, 0, 0, w, h)
    const mask = createMaskBuffer(w, h, 0)
    // Horizontal dark tape across mid
    for (let x = 4; x < w - 4; x += 1) {
      for (let t = 0; t < 3; t += 1) {
        const y = 18 + t
        setRgb(img, x, y, [40, 40, 45])
        mask.data[y * w + x] = 255
      }
    }
    // Border carpet KEEP
    for (let x = 0; x < w; x += 1) {
      mask.data[x] = 255
      mask.data[(h - 1) * w + x] = 255
    }
    const result = refineTexturedBorderLeak(mask, img)
    let tapeKeep = 0
    for (let x = 4; x < w - 4; x += 1) {
      if (result.mask.data[19 * w + x]! >= 128) tapeKeep += 1
    }
    expect(tapeKeep).toBeGreaterThan((w - 8) * 0.85)
  })

  it('rejects peel that would shrink KEEP by more than 10%', () => {
    const w = 32
    const h = 32
    const img = makeImage(w, h, [180, 170, 155])
    paintCarpet(img, 0, 0, w, h)
    const mask = createMaskBuffer(w, h, 255)
    const result = refineTexturedBorderLeak(mask, img)
    // Entire frame is textured — peel would wipe almost everything → reject
    expect(result.applied).toBe(false)
    expect(result.mask).toBe(mask)
  })
})
