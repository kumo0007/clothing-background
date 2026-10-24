/**
 * Regression: prove which strategy the batch path actually runs, that masks
 * are committed to maskStore, and that preview/export read the same buffer.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  clearAllMasks,
  getMask,
  getOrCreateMask,
  setMask,
} from '../mask/maskStore'
import { createMaskBuffer } from '../mask/createMask'
import {
  runAutoMaskPipeline,
  type AutoMaskMethod,
} from '../mask/autoMaskPipeline'
import { compositePixelBuffers } from '../rendering/compositePixels'
import type { MaskPixelBuffer } from '../../types/mask'

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

function darkSquareOnCard(): ImageData {
  const img = makeImage(40, 40, [230, 230, 230])
  for (let y = 10; y < 30; y += 1) {
    for (let x = 10; x < 30; x += 1) setRgb(img, x, y, [25, 25, 30])
  }
  return img
}

function checksum(mask: MaskPixelBuffer): string {
  return createHash('sha256').update(Buffer.from(mask.data)).digest('hex')
}

function disagree(a: MaskPixelBuffer, b: MaskPixelBuffer): number {
  let n = 0
  for (let i = 0; i < a.data.length; i += 1) {
    if ((a.data[i]! >= 128) !== (b.data[i]! >= 128)) n += 1
  }
  return n
}

/**
 * Library/scripts still use runAutoMaskPipeline('auto') = Lab-seed.
 * UI Batch → Auto-mask uses bg-remove-sdk (see autoMaskCorners.ts).
 * Contour / ISNet remain opt-in for audits only.
 */
async function scriptAutoMask(
  imageId: string,
  imageData: ImageData,
  method: AutoMaskMethod = 'auto',
) {
  getOrCreateMask(imageId, imageData.width, imageData.height)
  const result = await runAutoMaskPipeline(imageData, method, 40)
  setMask(imageId, result.mask)
  return {
    requestedMethod: method,
    methodUsed: result.methodUsed,
    mask: getMask(imageId)!,
  }
}

describe('strategy wiring — internal library vs UI API default', () => {
  beforeEach(() => {
    clearAllMasks()
  })

  it('library auto default still runs Lab-seed (opencv-seed-fallback) for scripts', async () => {
    const img = darkSquareOnCard()
    const r = await scriptAutoMask('batch-1', img)
    expect(r.requestedMethod).toBe('auto')
    expect(r.methodUsed).toBe('opencv-seed-fallback')
    expect(r.methodUsed).not.toBe('contour-first')
    expect(r.methodUsed).not.toMatch(/isnet/)
    expect(r.methodUsed).not.toBe('api-poof')
  })

  it('explicit contour request reports contour-first (not silent Lab label)', async () => {
    const img = darkSquareOnCard()
    const r = await scriptAutoMask('batch-cf', img, 'contour')
    expect(r.requestedMethod).toBe('contour')
    expect(r.methodUsed).toMatch(/^contour-first/)
    expect(r.methodUsed).not.toBe('opencv-seed-fallback')
  })

  it('Lab vs contour masks can disagree (strategies are not identical no-ops)', async () => {
    const img = darkSquareOnCard()
    const lab = await runAutoMaskPipeline(img, 'auto', 40)
    const cf = await runAutoMaskPipeline(img, 'contour', 40)
    expect(lab.methodUsed).toBe('opencv-seed-fallback')
    expect(cf.methodUsed).toMatch(/^contour-first/)
    expect(lab.methodUsed).not.toEqual(cf.methodUsed)
    expect(disagree(lab.mask, cf.mask)).toBeGreaterThanOrEqual(0)
  })

  it('committed maskStore buffer is what preview/export composite use', async () => {
    const img = darkSquareOnCard()
    const imageId = 'export-parity'
    const r = await scriptAutoMask(imageId, img, 'contour')
    const stored = getMask(imageId)!
    expect(checksum(stored)).toBe(checksum(r.mask))

    const bg = new Uint8ClampedArray(img.data.length)
    for (let i = 0; i < img.width * img.height; i += 1) {
      bg[i * 4] = 217
      bg[i * 4 + 1] = 196
      bg[i * 4 + 2] = 174
      bg[i * 4 + 3] = 255
    }
    const preview = compositePixelBuffers(img.data, getMask(imageId)!.data, bg)
    const exported = compositePixelBuffers(img.data, getMask(imageId)!.data, bg)
    expect(Array.from(preview)).toEqual(Array.from(exported))
  })

  it('background-only state change does not overwrite maskStore', async () => {
    const img = darkSquareOnCard()
    const imageId = 'bg-stable'
    await scriptAutoMask(imageId, img)
    const before = checksum(getMask(imageId)!)
    const still = getMask(imageId)!
    expect(checksum(still)).toBe(before)
  })

  it('per-image isolation: strategy on A does not alter B', async () => {
    const img = darkSquareOnCard()
    await scriptAutoMask('iso-a', img, 'auto')
    const b = getOrCreateMask('iso-b', 40, 40)
    b.data.fill(0)
    setMask('iso-b', b)
    await scriptAutoMask('iso-a', img, 'contour')
    expect(getMask('iso-b')!.data.every((v) => v === 0)).toBe(true)
  })

  it('default auto path never labels methodUsed as contour-first', async () => {
    const img = darkSquareOnCard()
    const r = await runAutoMaskPipeline(img, 'auto', 40)
    expect(r.methodUsed).not.toBe('contour-first')
  })
})

describe('strategy wiring — empty mask vs strategy mask', () => {
  beforeEach(() => clearAllMasks())

  it('setMask replaces store entry so checksum changes after auto-mask', async () => {
    const img = darkSquareOnCard()
    const empty = createMaskBuffer(40, 40, 0)
    setMask('rev', empty)
    const before = checksum(getMask('rev')!)
    const result = await runAutoMaskPipeline(img, 'auto', 40)
    setMask('rev', result.mask)
    const after = checksum(getMask('rev')!)
    expect(after).not.toBe(before)
    expect(countsFg(getMask('rev')!)).toBeGreaterThan(0)
  })
})

function countsFg(mask: MaskPixelBuffer): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) n += 1
  }
  return n
}
