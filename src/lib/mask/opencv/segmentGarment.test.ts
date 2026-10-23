/**
 * Garment segmentation tests (Lab-seed path in Node; GrabCut verified offline).
 */
import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import { compositePixelBuffers } from '../../rendering/compositePixels'
import {
  runAutoMaskPipeline,
  runBaselineAutoMask,
} from '../autoMaskPipeline'
import { probeGrabCutAvailable } from './loadOpenCv'
import { segmentGarmentWithOpenCv } from './segmentGarment'
import { segmentGarmentBySeeds } from './segmentSeeds'

function makeImageData(
  width: number,
  height: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4
    data[o] = fill[0]
    data[o + 1] = fill[1]
    data[o + 2] = fill[2]
    data[o + 3] = 255
  }
  return new ImageData(data as unknown as ImageDataArray, width, height)
}

function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
): void {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

function snapshotRgb(image: ImageData): Uint8ClampedArray {
  return new Uint8ClampedArray(image.data)
}

function keepRatio(mask: { data: Uint8ClampedArray }): number {
  let keep = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) keep += 1
  }
  return keep / mask.data.length
}

describe('OpenCV.js runtime capabilities', () => {
  it('documents GrabCut as verified in @techstark/opencv-js@4.10.0', async () => {
    // Offline probe (scripts/probeOpenCvApis.cjs) confirmed grabCut + CV_64FC1 models.
    // Node/vitest uses Lab-seed path because WASM init hangs under Vite.
    expect(await probeGrabCutAvailable()).toBe(true)
  })
})

describe('segmentGarmentWithOpenCv', () => {
  it('preserves source RGB and mask polarity on dark garment / light BG', async () => {
    const image = makeImageData(48, 48, [220, 220, 220])
    for (let y = 12; y < 36; y += 1) {
      for (let x = 12; x < 36; x += 1) {
        setRgb(image, x, y, [30, 30, 40])
      }
    }
    const before = snapshotRgb(image)
    const result = await segmentGarmentWithOpenCv(image, {
      maxWorkingSide: 48,
      grabCutIters: 2,
    })
    expect(Array.from(image.data)).toEqual(Array.from(before))
    expect(result.mask.width).toBe(48)
    expect(result.mask.height).toBe(48)
    expect(result.methodUsed).toBe('opencv-seed-fallback')

    // Center should be KEEP, corners REMOVE
    expect(result.mask.data[24 * 48 + 24]!).toBeGreaterThanOrEqual(128)
    expect(result.mask.data[0]!).toBeLessThan(128)
    expect(result.mask.data[47 * 48 + 47]!).toBeLessThan(128)

    const bg = new Uint8ClampedArray(48 * 48 * 4)
    for (let i = 0; i < 48 * 48; i += 1) {
      const o = i * 4
      bg[o] = 255
      bg[o + 1] = 0
      bg[o + 2] = 255
      bg[o + 3] = 255
    }
    const out = compositePixelBuffers(image.data, result.mask.data, bg)
    // Center garment RGB preserved
    const center = (24 * 48 + 24) * 4
    expect(out[center]!).toBe(30)
    expect(out[center + 1]!).toBe(30)
  }, 120_000)

  it('near-white FG on near-white BG: does not erase all interior pale pixels', async () => {
    const image = makeImageData(40, 40, [216, 216, 216])
    // Flat white upper + dark sole accents
    for (let y = 10; y < 28; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [248, 248, 248])
      }
    }
    for (let y = 26; y < 30; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [20, 20, 20])
      }
    }
    const result = await segmentGarmentWithOpenCv(image, {
      maxWorkingSide: 40,
      grabCutIters: 2,
    })
    // Dark sole kept
    expect(result.mask.data[28 * 40 + 20]!).toBeGreaterThanOrEqual(128)
    // Pale upper retained via brightLeather + sole-connected reclaim
    let paleKept = 0
    for (let y = 12; y < 24; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        if (result.mask.data[y * 40 + x]! >= 128) paleKept += 1
      }
    }
    expect(paleKept).toBeGreaterThan(80)
  }, 120_000)

  it('full auto pipeline retains sneaker-like pale panel connected to dark sole', async () => {
    const image = makeImageData(48, 48, [226, 226, 226])
    for (let y = 12; y < 34; y += 1) {
      for (let x = 12; x < 36; x += 1) {
        setRgb(image, x, y, [238, 238, 238])
      }
    }
    for (let y = 34; y < 38; y += 1) {
      for (let x = 12; x < 36; x += 1) {
        setRgb(image, x, y, [25, 25, 25])
      }
    }
    const result = await runAutoMaskPipeline(image, 'auto', 40)
    expect(result.mask.data[36 * 48 + 24]!).toBeGreaterThanOrEqual(128)
    let paleKept = 0
    for (let y = 14; y < 30; y += 1) {
      for (let x = 14; x < 34; x += 1) {
        if (result.mask.data[y * 48 + x]! >= 200) paleKept += 1
      }
    }
    expect(paleKept).toBeGreaterThan(120)
    // Outer corner studio removed
    expect(result.mask.data[1]!).toBeLessThan(128)
  }, 30_000)

  it('chromatic garment on neutral BG retains warm body', async () => {
    const image = makeImageData(36, 36, [210, 210, 212])
    for (let y = 8; y < 28; y += 1) {
      for (let x = 10; x < 26; x += 1) {
        setRgb(image, x, y, [180, 90, 60])
      }
    }
    const result = await segmentGarmentWithOpenCv(image, {
      maxWorkingSide: 36,
      grabCutIters: 2,
    })
    expect(result.mask.data[18 * 36 + 18]!).toBeGreaterThanOrEqual(128)
    expect(keepRatio(result.mask)).toBeGreaterThan(0.15)
    expect(keepRatio(result.mask)).toBeLessThan(0.85)
  }, 120_000)

  it('thin strap / disconnected detail: dark thin structure survives', async () => {
    const image = makeImageData(50, 40, [222, 222, 222])
    // Body
    for (let y = 15; y < 35; y += 1) {
      for (let x = 15; x < 35; x += 1) {
        setRgb(image, x, y, [40, 35, 30])
      }
    }
    // Thin vertical strap
    for (let y = 2; y < 16; y += 1) {
      setRgb(image, 24, y, [25, 25, 25])
      setRgb(image, 25, y, [25, 25, 25])
    }
    const result = await segmentGarmentWithOpenCv(image, {
      maxWorkingSide: 50,
      grabCutIters: 2,
    })
    expect(result.mask.data[8 * 50 + 24]!).toBeGreaterThanOrEqual(128)
  }, 120_000)

  it('garment touching image border is not entirely wiped', async () => {
    const image = makeImageData(32, 32, [230, 230, 230])
    for (let y = 0; y < 20; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        setRgb(image, x, y, [50, 20, 20])
      }
    }
    const result = await segmentGarmentWithOpenCv(image, {
      maxWorkingSide: 32,
      grabCutIters: 2,
    })
    expect(result.mask.data[2 * 32 + 16]!).toBeGreaterThanOrEqual(128)
  }, 120_000)

  it('seed-only path returns a valid mask without WASM', () => {
    const image = makeImageData(24, 24, [200, 200, 200])
    for (let y = 6; y < 18; y += 1) {
      for (let x = 6; x < 18; x += 1) {
        setRgb(image, x, y, [10, 10, 10])
      }
    }
    const result = segmentGarmentBySeeds(image)
    expect(result.methodUsed).toBe('opencv-seed-fallback')
    expect(result.mask.data[12 * 24 + 12]!).toBeGreaterThanOrEqual(128)
  })
})

describe('autoMaskPipeline', () => {
  it('auto path finishes without waiting on OpenCV WASM (UI hang fix)', async () => {
    const image = makeImageData(48, 48, [220, 220, 220])
    for (let y = 10; y < 38; y += 1) {
      for (let x = 10; x < 38; x += 1) {
        setRgb(image, x, y, [25, 25, 30])
      }
    }
    const t0 = Date.now()
    const result = await runAutoMaskPipeline(image, 'auto', 40)
    const elapsed = Date.now() - t0
    expect(result.methodUsed).toBe('opencv-seed-fallback')
    expect(result.mask.data[24 * 48 + 24]!).toBeGreaterThanOrEqual(128)
    // Must not sit on a 12–120s WASM timeout — seed path is seconds at most.
    expect(elapsed).toBeLessThan(15_000)
  }, 20_000)

  it('baseline and opencv both leave source RGB untouched', async () => {
    const image = makeImageData(28, 28, [215, 215, 215])
    for (let y = 6; y < 22; y += 1) {
      for (let x = 6; x < 22; x += 1) {
        setRgb(image, x, y, [60, 40, 30])
      }
    }
    const before = snapshotRgb(image)
    runBaselineAutoMask(image, 40)
    expect(Array.from(image.data)).toEqual(Array.from(before))
    await runAutoMaskPipeline(image, 'opencv', 40)
    expect(Array.from(image.data)).toEqual(Array.from(before))
  }, 120_000)

  it('batch sequential runs do not cross-contaminate mask buffers', async () => {
    const a = makeImageData(32, 32, [230, 230, 230])
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) setRgb(a, x, y, [20, 20, 20])
    }
    const b = makeImageData(32, 32, [230, 230, 230])
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) setRgb(b, x, y, [200, 40, 40])
    }
    const ra = await runAutoMaskPipeline(a, 'opencv', 40)
    const rb = await runAutoMaskPipeline(b, 'opencv', 40)
    expect(ra.mask.data).not.toBe(rb.mask.data)
    expect(ra.mask.data[16 * 32 + 16]!).toBeGreaterThanOrEqual(128)
    expect(rb.mask.data[16 * 32 + 16]!).toBeGreaterThanOrEqual(128)
  }, 120_000)

  it('preview/export polarity: KEEP composites original, REMOVE composites BG', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 255])
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 255
    mask.data[1] = 0
    const background = new Uint8ClampedArray([1, 2, 3, 255, 9, 9, 9, 255])
    const out = compositePixelBuffers(original, mask.data, background)
    expect(Array.from(out.slice(0, 3))).toEqual([10, 20, 30])
    expect(Array.from(out.slice(4, 7))).toEqual([9, 9, 9])
  })
})
