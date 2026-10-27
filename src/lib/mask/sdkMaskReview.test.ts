import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import { reviewSdkMask, maybeStripSdkBorderStudio } from './sdkMaskReview'
import { MaskHistory } from './maskHistory'
import { paintMaskCircle } from './paintMask'
import { clearAllMasks, getMask, setMask } from './maskStore'

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

describe('reviewSdkMask', () => {
  it('does not flag a clean pale neural mask as weak-dark-structure', () => {
    const w = 100
    const h = 100
    const img = makeImage(w, h, [246, 246, 246])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 20; y < 80; y += 1) {
      for (let x = 25; x < 75; x += 1) {
        setRgb(img, x, y, [244, 244, 242])
        mask.data[y * w + x] = 255
      }
    }
    const review = reviewSdkMask(mask, img, { resized: false })
    expect(review.needsReview).toBe(false)
    expect(review.reasons.join(' ')).not.toMatch(/weak dark structure/i)
  })

  it('expected model upsample is informational and does not force review alone', () => {
    const img = makeImage(8, 8, [240, 240, 240])
    const mask = createMaskBuffer(8, 8, 0)
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        setRgb(img, x, y, [30, 30, 35])
        mask.data[y * 8 + x] = 255
      }
    }
    const review = reviewSdkMask(mask, img, { resized: true })
    expect(review.findings.some((f) => f.ruleId === 'mask_resized')).toBe(true)
    expect(
      review.findings.find((f) => f.ruleId === 'mask_resized')?.forcesReview,
    ).toBe(false)
    expect(review.needsReview).toBe(false)
  })

  it('suspicious resize forces alignment review', () => {
    const img = makeImage(8, 8, [240, 240, 240])
    const mask = createMaskBuffer(8, 8, 0)
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        setRgb(img, x, y, [30, 30, 35])
        mask.data[y * 8 + x] = 255
      }
    }
    const review = reviewSdkMask(mask, img, {
      resized: true,
      resizedSuspicious: true,
    })
    expect(review.needsReview).toBe(true)
    expect(review.reasons.join(' ')).toMatch(/unexpected remap|resized/i)
  })

  it('manual edits remain authoritative in maskStore after review', () => {
    clearAllMasks()
    const mask = createMaskBuffer(32, 32, 0)
    mask.data.fill(200)
    setMask('edit-1', mask)
    const history = new MaskHistory()
    const current = getMask('edit-1')!
    history.push(current)
    paintMaskCircle(current, 8, 8, 3, 'remove')
    setMask('edit-1', current)

    // Reviewing a clone must not mutate the stored edited mask.
    const stored = getMask('edit-1')!
    const before = stored.data[8 * 32 + 8]
    const clone = {
      width: stored.width,
      height: stored.height,
      data: new Uint8ClampedArray(stored.data),
    }
    const img = makeImage(32, 32, [240, 240, 240])
    reviewSdkMask(clone, img, { resized: false })
    expect(getMask('edit-1')!.data[8 * 32 + 8]).toBe(before)
    expect(before).toBe(0)
  })
})

describe('maybeStripSdkBorderStudio / preview peel', () => {
  it('refuses peel when border studio ratio is already low', () => {
    const w = 64
    const h = 64
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) {
        setRgb(img, x, y, [40, 40, 45])
        mask.data[y * w + x] = 255
      }
    }
    const before = Array.from(mask.data)
    const out = maybeStripSdkBorderStudio(mask, img)
    expect(out.refined).toBe(false)
    expect(Array.from(mask.data)).toEqual(before)
  })

  it('reviewSdkMask never mutates the mask', () => {
    const w = 40
    const h = 40
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 4 || x < 4) mask.data[y * w + x] = 255
        if (y > 10 && y < 30 && x > 10 && x < 30) {
          setRgb(img, x, y, [20, 20, 25])
          mask.data[y * w + x] = 255
        }
      }
    }
    const before = Array.from(mask.data)
    reviewSdkMask(mask, img, { resized: false })
    expect(Array.from(mask.data)).toEqual(before)
  })
})
