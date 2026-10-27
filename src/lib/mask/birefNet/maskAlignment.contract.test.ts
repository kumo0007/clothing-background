import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import { logitsToMaskBuffer } from './postprocess'
import { BIREFNET_INPUT_SIZE } from './constants'

describe('BiRefNet mask alignment contract', () => {
  it('resamples model logits to exact source dimensions (no letterbox crop)', () => {
    const mw = BIREFNET_INPUT_SIZE
    const mh = BIREFNET_INPUT_SIZE
    const logits = new Float32Array(mw * mh)
    logits.fill(-8)
    // Strong KEEP in model center
    for (let y = 200; y < 312; y += 1) {
      for (let x = 200; x < 312; x += 1) {
        logits[y * mw + x] = 8
      }
    }
    const srcW = 800
    const srcH = 600
    const mask = logitsToMaskBuffer(logits, mw, mh, srcW, srcH)
    expect(mask.width).toBe(srcW)
    expect(mask.height).toBe(srcH)
    expect(mask.data.length).toBe(srcW * srcH)
    // Mapped center should be KEEP
    expect(mask.data[300 * srcW + 400]!).toBeGreaterThanOrEqual(128)
    // Corners should be BG
    expect(mask.data[0]!).toBeLessThan(128)
    expect(mask.data[srcW * srcH - 1]!).toBeLessThan(128)
  })

  it('preserves soft alpha (not forced binary) at edges', () => {
    const mw = 32
    const mh = 32
    const logits = new Float32Array(mw * mh)
    for (let i = 0; i < logits.length; i += 1) logits[i] = -4
    logits[16 * mw + 16] = 0 // ~0.5 after sigmoid
    const mask = logitsToMaskBuffer(logits, mw, mh, 64, 64)
    const soft = [...mask.data].filter((v) => v > 0 && v < 200)
    expect(soft.length).toBeGreaterThan(0)
  })

  it('row-major indexing y*width+x is used end-to-end', () => {
    const mask = createMaskBuffer(10, 5, 0)
    mask.data[2 * 10 + 3] = 255
    expect(mask.data[23]).toBe(255)
  })
})
