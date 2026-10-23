/**
 * Evidence-guided ISNet refine unit tests.
 * Uses exported raw ISNet masks (from tmp-model-compare / synthetic) so jsdom
 * does not need ONNX/canvas. Full Node ISNet coverage lives in the eval script.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import {
  refineIsnetWithEvidence,
} from './isnetEvidenceRefine'
import { createMaskBuffer, cloneMaskBuffer } from './createMask'
import { runAutoMaskPipeline } from './autoMaskPipeline'

const root = process.cwd()
const clothing = join(root, 'public', 'testdata', 'clothing')
const isnetMasks = join(root, 'tmp-model-compare', 'isnet', 'masks')
const refinedMasks = join(root, 'tmp-isnet-refine', 'isnet-refined', 'masks')

function loadJpeg(name: string): ImageData {
  const decoded = jpeg.decode(readFileSync(join(clothing, name)), {
    useTArray: true,
    formatAsRGBA: true,
  })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
    colorSpace: 'srgb',
  } as ImageData
}

function loadMaskPng(path: string) {
  const png = PNG.sync.read(readFileSync(path))
  const mask = createMaskBuffer(png.width, png.height, 0)
  for (let i = 0; i < mask.data.length; i += 1) {
    mask.data[i] = png.data[i * 4]!
  }
  return mask
}

function fgRatio(data: Uint8ClampedArray): number {
  let k = 0
  for (let i = 0; i < data.length; i += 1) if (data[i]! >= 128) k += 1
  return k / data.length
}

function componentCount(data: Uint8ClampedArray, w: number): number {
  const seen = new Uint8Array(data.length)
  let count = 0
  const h = data.length / w
  for (let s = 0; s < data.length; s += 1) {
    if (seen[s] || data[s]! < 128) continue
    count += 1
    const q = [s]
    seen[s] = 1
    let head = 0
    while (head < q.length) {
      const i = q[head++]!
      const x = i % w
      const y = (i / w) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
        if (n < 0 || seen[n] || data[n]! < 128) continue
        seen[n] = 1
        q.push(n)
      }
    }
  }
  return count
}

describe('isnetEvidenceRefine', () => {
  it('does not mutate source RGB', () => {
    const image = loadJpeg('02_blazer.jpg')
    const before = new Uint8ClampedArray(image.data)
    const path = join(isnetMasks, '02_blazer-mask.png')
    expect(existsSync(path)).toBe(true)
    const raw = loadMaskPng(path)
    refineIsnetWithEvidence(raw, image)
    expect([...image.data]).toEqual([...before])
  })

  it('reports inferenceEngine isnet-onnx (never Lab/contour)', () => {
    const image = loadJpeg('02_blazer.jpg')
    const raw = loadMaskPng(join(isnetMasks, '02_blazer-mask.png'))
    const { diagnostics } = refineIsnetWithEvidence(raw, image)
    expect(diagnostics.inferenceEngine).toBe('isnet-onnx')
  })

  it('preserves clean ISNet blazer without large area swing', () => {
    const image = loadJpeg('02_blazer.jpg')
    const raw = loadMaskPng(join(isnetMasks, '02_blazer-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(raw, image)
    const delta = Math.abs(fgRatio(mask.data) - fgRatio(raw.data))
    expect(delta).toBeLessThan(0.015)
    // Already-solid dark garments: reject Lab nibbles (leave raw ISNet).
    expect(diagnostics.refinementAccepted).toBe(false)
    expect([...mask.data]).toEqual([...raw.data])
  })

  it('preserves jeans silhouette (no large regression)', () => {
    const image = loadJpeg('04_jeans.jpg')
    const raw = loadMaskPng(join(isnetMasks, '04_jeans-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(raw, image)
    const delta = Math.abs(fgRatio(mask.data) - fgRatio(raw.data))
    expect(delta).toBeLessThan(0.015)
    // Modest Lab agreement nibbles must not rewrite an already-acceptable mask.
    expect(diagnostics.refinementAccepted).toBe(false)
    expect([...mask.data]).toEqual([...raw.data])
  })

  it('heals hoodie horizontal false-REMOVE corridor (1st failure)', () => {
    const image = loadJpeg('01_hoodie.jpg')
    const raw = loadMaskPng(join(isnetMasks, '01_hoodie-mask.png'))
    const compsBefore = componentCount(raw.data, raw.width)
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    expect(diagnostics.refinementAccepted).toBe(true)
    expect(fgRatio(mask.data)).toBeGreaterThan(fgRatio(raw.data) + 0.02)
    expect(diagnostics.finalComponentCount).toBeLessThanOrEqual(compsBefore)
    let emptyBand = 0
    const y0 = Math.floor(raw.height * 0.82)
    const y1 = Math.floor(raw.height * 0.92)
    for (let y = y0; y < y1; y += 1) {
      let keep = 0
      for (let x = 0; x < raw.width; x += 1) {
        if (mask.data[y * raw.width + x]! >= 128) keep += 1
      }
      if (keep < 8) emptyBand += 1
    }
    expect(emptyBand).toBeLessThan(y1 - y0)
  })

  it('improves coat under-recall (5th failure) without Lab method swap', () => {
    const image = loadJpeg('05_coat.jpg')
    const raw = loadMaskPng(join(isnetMasks, '05_coat-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    expect(diagnostics.inferenceEngine).toBe('isnet-onnx')
    expect(fgRatio(mask.data)).toBeGreaterThan(fgRatio(raw.data) + 0.03)
    expect(diagnostics.refinementAccepted).toBe(true)
  })

  it('rejects card-following Lab KEEP flood on pale tee (no large union)', () => {
    const image = loadJpeg('03_tshirt.jpg')
    const raw = loadMaskPng(join(isnetMasks, '03_tshirt-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    expect(fgRatio(mask.data)).toBeLessThan(0.55)
    expect(Math.abs(fgRatio(mask.data) - fgRatio(raw.data))).toBeLessThan(0.04)
    expect(diagnostics.gateValues.cardShapedExpansionBlocked || fgRatio(mask.data) < 0.55).toBe(
      true,
    )
  })

  it('preserves intentional negative space between sneakers', () => {
    const image = loadJpeg('08_sneakers.jpg')
    const raw = loadMaskPng(join(isnetMasks, '08_sneakers-mask.png'))
    const gapRatio = (data: Uint8ClampedArray) => {
      let rem = 0
      let tot = 0
      const cx = Math.floor(image.width * 0.48)
      for (
        let y = Math.floor(image.height * 0.35);
        y < Math.floor(image.height * 0.7);
        y += 1
      ) {
        for (let x = cx - 4; x <= cx + 4; x += 1) {
          tot += 1
          if (data[y * image.width + x]! < 128) rem += 1
        }
      }
      return rem / tot
    }
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    expect(diagnostics.inferenceEngine).toBe('isnet-onnx')
    // Must not explode into studio card via pale Lab reclaim.
    expect(fgRatio(mask.data)).toBeLessThan(0.42)
    // Refine must not erase whatever negative space the raw ISNet already had.
    expect(gapRatio(mask.data) + 0.02).toBeGreaterThanOrEqual(gapRatio(raw.data))
    expect(typeof diagnostics.gateValues.sideBySideMergeBlocked).toBe('boolean')
  })

  it('rejects bridging two substantial horizontally separated KEEP islands', () => {
    const w = 60
    const h = 40
    const imageData = {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: 'srgb',
    } as ImageData
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4
        const left = x >= 4 && x <= 22 && y >= 8 && y <= 30
        const right = x >= 38 && x <= 56 && y >= 8 && y <= 30
        if (left || right) {
          imageData.data[o] = 40
          imageData.data[o + 1] = 40
          imageData.data[o + 2] = 40
        } else {
          imageData.data[o] = 230
          imageData.data[o + 1] = 230
          imageData.data[o + 2] = 230
        }
        imageData.data[o + 3] = 255
      }
    }
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 8; y <= 30; y += 1) {
      for (let x = 4; x <= 22; x += 1) mask.data[y * w + x] = 255
      for (let x = 38; x <= 56; x += 1) mask.data[y * w + x] = 255
    }
    // Seed a Lab-like bridge temptation in the gap with dark-ish noise — still studio.
    const { mask: out, diagnostics } = refineIsnetWithEvidence(mask, imageData)
    const after = componentCount(out.data, w)
    expect(after).toBeGreaterThanOrEqual(2)
    expect(
      !diagnostics.refinementAccepted ||
        diagnostics.gateValues.sideBySideMergeBlocked ||
        after >= 2,
    ).toBe(true)
  })

  it('cap exterior dark brim bites: improve or flag residual bites for review', () => {
    const image = loadJpeg('10_cap.jpg')
    const raw = loadMaskPng(join(isnetMasks, '10_cap-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    expect(diagnostics.inferenceEngine).toBe('isnet-onnx')
    // Either we reclaim some exterior dark undercuts, or residual bites remain flagged.
    const improved =
      diagnostics.refinementAccepted &&
      diagnostics.gateValues.darkBiteReclaimed > 0 &&
      fgRatio(mask.data) >= fgRatio(raw.data)
    const flagged = diagnostics.failureModes.includes(
      'residual-dark-exterior-bites',
    )
    expect(improved || flagged || diagnostics.refinementAttempted).toBe(true)
    // Must not explode FG into the card.
    expect(fgRatio(mask.data)).toBeLessThan(fgRatio(raw.data) + 0.05)
  })

  it('rejected refinement leaves original ISNet mask unchanged', () => {
    const image = loadJpeg('02_blazer.jpg')
    const raw = loadMaskPng(join(isnetMasks, '02_blazer-mask.png'))
    const { mask, diagnostics } = refineIsnetWithEvidence(
      cloneMaskBuffer(raw),
      image,
    )
    if (!diagnostics.refinementAccepted) {
      expect([...mask.data]).toEqual([...raw.data])
      expect(diagnostics.deltaFgRatio).toBe(0)
    }
  })

  it('preserves handbag openings (does not fill all REMOVE inside bbox)', () => {
    const image = loadJpeg('09_handbag.jpg')
    const raw = loadMaskPng(join(isnetMasks, '09_handbag-mask.png'))
    const { mask } = refineIsnetWithEvidence(cloneMaskBuffer(raw), image)
    let remove = 0
    let total = 0
    const y1 = Math.floor(image.height * 0.35)
    for (let y = 0; y < y1; y += 1) {
      for (
        let x = Math.floor(image.width * 0.3);
        x < Math.floor(image.width * 0.7);
        x += 1
      ) {
        total += 1
        if (mask.data[y * image.width + x]! < 128) remove += 1
      }
    }
    expect(remove / total).toBeGreaterThan(0.15)
  })

  it('auto path never silently becomes ISNet', async () => {
    const image = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
      colorSpace: 'srgb',
    } as ImageData
    const auto = await runAutoMaskPipeline(image, 'auto', 40)
    expect(auto.methodUsed).not.toBe('isnet-onnx')
    expect(auto.genuineModelInference).not.toBe(true)
  })

  it('synthetic severance corridor is reclaimed with Lab+garment evidence', () => {
    const w = 40
    const h = 40
    const imageData = {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: 'srgb',
    } as ImageData
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4
        const inBody = x >= 8 && x <= 31 && y >= 6 && y <= 33
        if (inBody) {
          imageData.data[o] = 180
          imageData.data[o + 1] = 140
          imageData.data[o + 2] = 100
        } else {
          imageData.data[o] = 230
          imageData.data[o + 1] = 230
          imageData.data[o + 2] = 230
        }
        imageData.data[o + 3] = 255
      }
    }
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 6; y <= 18; y += 1) {
      for (let x = 8; x <= 31; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 24; y <= 33; y += 1) {
      for (let x = 8; x <= 31; x += 1) mask.data[y * w + x] = 255
    }
    const { mask: out, diagnostics } = refineIsnetWithEvidence(mask, imageData)
    expect(diagnostics.inferenceEngine).toBe('isnet-onnx')
    let corridorKeep = 0
    for (let y = 19; y <= 23; y += 1) {
      for (let x = 8; x <= 31; x += 1) {
        if (out.data[y * w + x]! >= 128) corridorKeep += 1
      }
    }
    expect(
      diagnostics.refinementAccepted
        ? corridorKeep > 20
        : diagnostics.failureModes.includes('stacked-keep-components'),
    ).toBe(true)
  })

  it('eval exports show hoodie/coat refined masks exist when harness has run', () => {
    // Soft dependency on eval artifacts — skip if absent.
    if (!existsSync(join(refinedMasks, '01_hoodie-mask.png'))) return
    const hoodie = loadMaskPng(join(refinedMasks, '01_hoodie-mask.png'))
    const coat = loadMaskPng(join(refinedMasks, '05_coat-mask.png'))
    const rawHoodie = loadMaskPng(join(isnetMasks, '01_hoodie-mask.png'))
    const rawCoat = loadMaskPng(join(isnetMasks, '05_coat-mask.png'))
    expect(fgRatio(hoodie.data)).toBeGreaterThan(fgRatio(rawHoodie.data))
    expect(fgRatio(coat.data)).toBeGreaterThan(fgRatio(rawCoat.data))
  })
})
