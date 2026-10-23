import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import {
  REF_BG,
  REF_FG,
  REF_UNCERTAIN,
  buildIndependentReferenceMask,
} from './referenceMask'
import { computeBinaryMetrics, computeBoundaryMetrics } from './metrics'

function makeImage(
  w: number,
  h: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4
    data[o] = fill[0]
    data[o + 1] = fill[1]
    data[o + 2] = fill[2]
    data[o + 3] = 255
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

describe('audit reference + metrics', () => {
  it('does not treat uncertain pixels as binary errors', () => {
    const ref = createMaskBuffer(4, 4, REF_UNCERTAIN)
    ref.data[0] = REF_FG
    ref.data[1] = REF_BG
    const pred = createMaskBuffer(4, 4, 0)
    pred.data[0] = 255
    pred.data[1] = 0
    // Wrong on uncertain cells — must not affect scores
    pred.data[2] = 255
    pred.data[3] = 255
    const m = computeBinaryMetrics(pred, ref)
    expect(m.scoredPixels).toBe(2)
    expect(m.fgRecall).toBe(1)
    expect(m.bgRecall).toBe(1)
    expect(m.iou).toBe(1)
  })

  it('independent reference marks dark interior FG and border studio BG', () => {
    const image = makeImage(24, 24, [230, 230, 230])
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        setRgb(image, x, y, [20, 20, 20])
      }
    }
    // Enclosed pale pocket (not border-connected) stays uncertain
    for (let y = 10; y < 14; y += 1) {
      for (let x = 10; x < 14; x += 1) {
        setRgb(image, x, y, [232, 232, 232])
      }
    }
    const ref = buildIndependentReferenceMask(image)
    expect(ref.data[9 * 24 + 9]).toBe(REF_FG)
    expect(ref.data[0]).toBe(REF_BG)
    expect(ref.data[12 * 24 + 12]).toBe(REF_UNCERTAIN)
  })

  it('boundary metrics report soft alpha MAE separately', () => {
    const ref = createMaskBuffer(6, 6, REF_UNCERTAIN)
    const pred = createMaskBuffer(6, 6, 0)
    for (let y = 2; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) {
        ref.data[y * 6 + x] = REF_FG
        pred.data[y * 6 + x] = 200
      }
    }
    for (let x = 0; x < 6; x += 1) {
      ref.data[x] = REF_BG
      ref.data[5 * 6 + x] = REF_BG
    }
    const b = computeBoundaryMetrics(pred, ref, 2)
    expect(b.edgeBandPixels).toBeGreaterThan(0)
    expect(b.softAlphaMae).not.toBeNull()
  })
})
