import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import {
  buildDiagnosticOverlay,
  runMaskDiagnostics,
} from './runMaskDiagnostics'
import { previewBorderStudioPeel } from './borderStudioRepair'
import { computeMaskMetrics } from './maskMetrics'
import { analyzeKeepComponents } from './fragmentation'

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

describe('runMaskDiagnostics', () => {
  it('does not mutate the mask during detection', () => {
    const w = 64
    const h = 64
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 10; y < 54; y += 1) {
      for (let x = 10; x < 54; x += 1) {
        setRgb(img, x, y, [40, 40, 45])
        mask.data[y * w + x] = 255
      }
    }
    const before = Array.from(mask.data)
    runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'bg-remove-sdk-rmbg1.4',
    })
    expect(Array.from(mask.data)).toEqual(before)
  })

  it('flags border studio leak with ruleId and evidence', () => {
    const w = 80
    const h = 80
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 6 || x < 6 || y > h - 7 || x > w - 7) {
          mask.data[y * w + x] = 255
        }
        if (y > 20 && y < 60 && x > 20 && x < 60) {
          setRgb(img, x, y, [30, 30, 35])
          mask.data[y * w + x] = 255
        }
      }
    }
    const d = runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'test',
    })
    expect(d.needsReview).toBe(true)
    const leak = d.findings.find((f) => f.ruleId === 'border_studio_leak')
    expect(leak).toBeTruthy()
    expect(leak!.measuredValue).toBeGreaterThan(leak!.threshold)
    expect(leak!.suggestedAction.length).toBeGreaterThan(0)
  })

  it('neural: clean pale garment is not forced to review', () => {
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
    const d = runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'bg-remove-sdk-rmbg1.4',
    })
    expect(d.needsReview).toBe(false)
    expect(d.findings.some((f) => f.ruleId === 'border_studio_leak')).toBe(
      false,
    )
  })

  it('buildDiagnosticOverlay produces RGBA without touching mask', () => {
    const mask = createMaskBuffer(4, 4, 0)
    mask.data[5] = 255
    mask.data[6] = 100
    const before = Array.from(mask.data)
    const overlay = buildDiagnosticOverlay(mask, 'soft')
    expect(overlay).toBeInstanceOf(ImageData)
    expect(overlay.width).toBe(4)
    expect(overlay.data[6 * 4 + 3]).toBeGreaterThan(0)
    expect(Array.from(mask.data)).toEqual(before)
  })

  it('buildDiagnosticOverlay fragments overlay returns real ImageData (not a plain object)', () => {
    const mask = createMaskBuffer(8, 8, 0)
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) mask.data[y * 8 + x] = 255
    }
    mask.data[0] = 255
    const overlay = buildDiagnosticOverlay(mask, 'fragments')
    // putImageData requires instanceof ImageData; plain object casts throw in browsers.
    expect(overlay).toBeInstanceOf(ImageData)
    expect(overlay.width).toBe(8)
    expect(overlay.height).toBe(8)
    expect(overlay.data).toBeInstanceOf(Uint8ClampedArray)
    expect(overlay.data.length).toBe(8 * 8 * 4)
    expect(overlay.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true)
  })

  it('overlay RGBA can be copied into a fresh ImageData buffer (Firefox-safe path)', () => {
    const mask = createMaskBuffer(4, 4, 255)
    const overlay = buildDiagnosticOverlay(mask, 'keep')
    // ReviewDiagnosticsPanel copies overlay.data into ctx.createImageData(...).
    // Assert the source buffer is a transferable RGBA length without needing canvas.
    const dest = new ImageData(4, 4)
    expect(dest.data.length).toBe(4 * 4 * 4)
    expect(() => dest.data.set(overlay.data)).not.toThrow()
    expect(dest.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true)
  })

  it('expected resize finding is info and does not force review by itself', () => {
    const w = 64
    const h = 64
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 12; y < 52; y += 1) {
      for (let x = 12; x < 52; x += 1) {
        setRgb(img, x, y, [35, 35, 40])
        mask.data[y * w + x] = 255
      }
    }
    const d = runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'birefnet-lite-512',
      resized: true,
    })
    const resized = d.findings.find((f) => f.ruleId === 'mask_resized')
    expect(resized).toBeTruthy()
    expect(resized!.severity).toBe('info')
    expect(resized!.forcesReview).toBe(false)
    expect(d.needsReview).toBe(false)
  })

  it('fill-frame collar does not force border_studio_leak peel', () => {
    const w = 80
    const h = 80
    const img = makeImage(w, h, [240, 240, 238])
    const mask = createMaskBuffer(w, h, 0)
    // Near-fill white garment including the frame (collar close-up).
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 8 || x < 8 || y > h - 9 || x > w - 9 || (y > 10 && y < 70 && x > 10 && x < 70)) {
          setRgb(img, x, y, [248, 248, 246])
          mask.data[y * w + x] = 255
        }
      }
    }
    const d = runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'birefnet-lite-512',
    })
    const leak = d.findings.find((f) => f.ruleId === 'border_studio_leak')
    if (leak) {
      expect(leak.forcesReview).toBe(false)
      expect(leak.severity).toBe('uncertain')
    }
  })

  it('fragments overlay uses labelMap and does not report dust as measuredValue', () => {
    const w = 60
    const h = 60
    const img = makeImage(w, h, [240, 240, 240])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 10; y < 50; y += 1) {
      for (let x = 10; x < 50; x += 1) {
        setRgb(img, x, y, [40, 40, 45])
        mask.data[y * w + x] = 255
      }
    }
    for (let i = 0; i < 80; i += 1) {
      const x = (i * 7) % w
      const y = (i * 11) % h
      if (mask.data[y * w + x]! < 128) mask.data[y * w + x] = 255
    }
    const analysis = analyzeKeepComponents(mask)
    expect(analysis.summary.totalComponents).toBeGreaterThan(20)
    const d = runMaskDiagnostics({
      mask,
      imageData: img,
      profile: 'neural',
      method: 'bg-remove-sdk-rmbg1.4',
    })
    const frag = d.findings.find((f) => f.ruleId === 'fragmented_keep')
    // Dust-only around a solid body must not force fragmented_keep
    expect(frag).toBeUndefined()
    const overlay = buildDiagnosticOverlay(mask, 'fragments')
    expect(overlay.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true)
  })
})

describe('previewBorderStudioPeel', () => {
  it('does not mutate source mask', () => {
    const w = 48
    const h = 48
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    for (let i = 0; i < mask.data.length; i += 1) mask.data[i] = 255
    const before = Array.from(mask.data)
    previewBorderStudioPeel(mask, img)
    expect(Array.from(mask.data)).toEqual(before)
  })
})

describe('computeMaskMetrics polarity', () => {
  it('counts KEEP/BG/soft from alpha convention', () => {
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 255
    mask.data[1] = 90
    const m = computeMaskMetrics(mask, undefined)
    expect(m.keepCount).toBe(1)
    expect(m.softCount).toBe(1)
    expect(m.bgCount).toBe(1)
  })
})
