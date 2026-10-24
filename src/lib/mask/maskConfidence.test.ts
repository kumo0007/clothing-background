import { describe, expect, it } from 'vitest'
import { estimateMaskConfidence } from './maskConfidence'
import { createMaskBuffer } from './createMask'

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
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
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

/** Pale garment on studio card with clean edges — typical RMBG white tee. */
function paleGarmentClean() {
  const w = 120
  const h = 120
  const img = makeImage(w, h, [245, 245, 245])
  const mask = createMaskBuffer(w, h, 0)
  for (let y = 25; y < 95; y += 1) {
    for (let x = 30; x < 90; x += 1) {
      // Near-card pale (within studioLuma-4) so paleAmongKeep is high.
      setRgb(img, x, y, [244, 244, 242])
      mask.data[y * w + x] = 255
    }
  }
  // Soft rim
  for (let y = 25; y < 95; y += 1) {
    mask.data[y * w + 30] = 100
    mask.data[y * w + 89] = 100
  }
  return { img, mask }
}

/** Pale KEEP that also leaks into the border band (genuine risk). */
function paleWithBorderLeak() {
  const { img, mask } = paleGarmentClean()
  const w = mask.width
  const h = mask.height
  for (let x = 0; x < w; x += 1) {
    mask.data[x] = 255
    mask.data[(h - 1) * w + x] = 255
  }
  for (let y = 0; y < h; y += 1) {
    mask.data[y * w] = 255
    mask.data[y * w + (w - 1)] = 255
  }
  return { img, mask }
}

describe('estimateMaskConfidence — pale garment policy', () => {
  it('neural: clean pale garment does not force review for weak dark structure', () => {
    const { img, mask } = paleGarmentClean()
    const conf = estimateMaskConfidence(mask, img, { profile: 'neural' })
    expect(conf.reasons.join(' ')).not.toMatch(/weak dark structure/i)
    expect(conf.needsReview).toBe(false)
    expect(conf.stats?.paleAmongKeep ?? 0).toBeGreaterThan(0.3)
    expect(conf.stats?.darkShareAmongKeep ?? 1).toBeLessThan(0.02)
  })

  it('neural: pale KEEP with border leakage still needs review', () => {
    const { img, mask } = paleWithBorderLeak()
    const conf = estimateMaskConfidence(mask, img, { profile: 'neural' })
    expect(conf.needsReview).toBe(true)
    expect(
      conf.reasons.some(
        (r) => r.includes('border-band') || r.includes('edge risk'),
      ),
    ).toBe(true)
  })

  it('classical: large pale slab can still request review', () => {
    const { img, mask } = paleGarmentClean()
    // Flood almost everything pale KEEP — classical Lab failure mode.
    mask.data.fill(255)
    const conf = estimateMaskConfidence(mask, img, { profile: 'classical' })
    expect(conf.needsReview).toBe(true)
  })

  it('colorAware:false ignores pale/dark studio heuristics', () => {
    const { img, mask } = paleWithBorderLeak()
    const conf = estimateMaskConfidence(mask, img, {
      profile: 'neural',
      colorAware: false,
    })
    expect(conf.reasons.some((r) => r.includes('pale'))).toBe(false)
    expect(conf.reasons.some((r) => r.includes('border-band'))).toBe(false)
  })

  it('dark garment on pale card scores confidently', () => {
    const w = 100
    const h = 100
    const img = makeImage(w, h, [240, 240, 240])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 20; y < 80; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        setRgb(img, x, y, [30, 32, 36])
        mask.data[y * w + x] = 255
      }
    }
    const conf = estimateMaskConfidence(mask, img, { profile: 'neural' })
    expect(conf.needsReview).toBe(false)
    expect(conf.score).toBeGreaterThanOrEqual(0.7)
  })
})
