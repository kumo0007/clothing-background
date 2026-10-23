import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import {
  contourRoundTripChangedPixels,
  extractMaskContours,
  simplifyPolygon,
} from './maskContour'
import { fillPolygonOnMask, applyPolygonRingsToMask } from './polygonMask'
import { compositePixelBuffers } from '../rendering/compositePixels'
import { MaskHistory } from './maskHistory'
import { clearAllMasks, getOrCreateMask, setMask } from './maskStore'
import { peelExteriorStudioKeep } from './selectSimilar'

function paintRect(
  mask: ReturnType<typeof createMaskBuffer>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value = 255,
) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      mask.data[y * mask.width + x] = value
    }
  }
}

describe('maskContour extraction', () => {
  it('traces actual concave silhouette, not a bounding box', () => {
    const mask = createMaskBuffer(40, 40, 0)
    // L-shaped garment
    paintRect(mask, 5, 5, 25, 15)
    paintRect(mask, 5, 5, 15, 30)
    const rings = extractMaskContours(mask, { simplifyTolerance: 0.75 })
    expect(rings.length).toBeGreaterThanOrEqual(1)
    const exterior = rings.find((r) => !r.isHole)!
    expect(exterior.points.length).toBeGreaterThan(4)
    // Bounding box would be 4 corners; concave L needs more vertices.
    expect(exterior.points.length).toBeGreaterThan(6)
  })

  it('extracts interior holes as subtractive rings', () => {
    const mask = createMaskBuffer(30, 30, 0)
    paintRect(mask, 3, 3, 27, 27)
    paintRect(mask, 10, 10, 18, 18, 0) // hole
    const rings = extractMaskContours(mask, { simplifyTolerance: 1 })
    expect(rings.some((r) => r.isHole)).toBe(true)
  })

  it('supports multiple disconnected components', () => {
    const mask = createMaskBuffer(50, 30, 0)
    paintRect(mask, 2, 5, 18, 25)
    paintRect(mask, 32, 5, 48, 25)
    const rings = extractMaskContours(mask, { simplifyTolerance: 1 })
    const exteriors = rings.filter((r) => !r.isHole)
    expect(exteriors.length).toBeGreaterThanOrEqual(2)
  })

  it('preserves thin structures under conservative simplification', () => {
    const mask = createMaskBuffer(40, 40, 0)
    paintRect(mask, 18, 2, 22, 38) // thin vertical strap
    const rings = extractMaskContours(mask, { simplifyTolerance: 1.25 })
    const rebuilt = createMaskBuffer(40, 40, 0)
    for (const ring of rings.filter((r) => !r.isHole)) {
      fillPolygonOnMask(rebuilt, ring.points, 'add')
    }
    let strapKeep = 0
    for (let y = 5; y < 35; y += 1) {
      if (rebuilt.data[y * 40 + 20]! >= 128) strapKeep += 1
    }
    expect(strapKeep).toBeGreaterThan(20)
  })

  it('round-trip changes few pixels at native resolution', () => {
    const mask = createMaskBuffer(24, 24, 0)
    paintRect(mask, 4, 4, 20, 20)
    paintRect(mask, 9, 9, 14, 14, 0)
    const { changed, rings } = contourRoundTripChangedPixels(mask, {
      simplifyTolerance: 0.5,
    })
    expect(rings.length).toBeGreaterThanOrEqual(1)
    // Allow small boundary disagreement from pixel-center sampling.
    expect(changed).toBeLessThan(mask.data.length * 0.08)
  })

  it('simplifyPolygon keeps endpoints and sharp corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const simple = simplifyPolygon(pts, 0.5)
    expect(simple.length).toBeGreaterThanOrEqual(4)
  })
})

describe('contour + polygon ops + history', () => {
  it('hole subtract via rings is reversible through MaskHistory', () => {
    const mask = createMaskBuffer(20, 20, 0)
    applyPolygonRingsToMask(
      mask,
      [
        [
          { x: 1, y: 1 },
          { x: 18, y: 1 },
          { x: 18, y: 18 },
          { x: 1, y: 18 },
        ],
        [
          { x: 6, y: 6 },
          { x: 12, y: 6 },
          { x: 12, y: 12 },
          { x: 6, y: 12 },
        ],
      ],
      ['add', 'subtract'],
    )
    expect(mask.data[9 * 20 + 9]).toBe(0)
    expect(mask.data[3 * 20 + 3]).toBe(255)

    const history = new MaskHistory()
    history.push(mask)
    fillPolygonOnMask(
      mask,
      [
        { x: 6, y: 6 },
        { x: 12, y: 6 },
        { x: 12, y: 12 },
        { x: 6, y: 12 },
      ],
      'add',
    )
    expect(mask.data[9 * 20 + 9]).toBe(255)
    const undone = history.undo(mask)!
    expect(undone.data[9 * 20 + 9]).toBe(0)
  })

  it('per-image isolation: contour edit on A does not touch B', () => {
    clearAllMasks()
    const a = getOrCreateMask('c-a', 10, 10)
    const b = getOrCreateMask('c-b', 10, 10)
    a.data.fill(0)
    b.data.fill(255)
    const rings = extractMaskContours(a)
    expect(rings.length).toBe(0)
    setMask('c-a', a)
    expect(b.data.every((v) => v === 255)).toBe(true)
    clearAllMasks()
  })
})

describe('compositing polarity contract', () => {
  it('preview formula matches export: keep garment RGB, replace on 0', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 255])
    const mask = new Uint8ClampedArray([255, 0])
    const bg = new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 255])
    const out = compositePixelBuffers(original, mask, bg)
    expect(Array.from(out.slice(0, 3))).toEqual([10, 20, 30])
    expect(Array.from(out.slice(4, 7))).toEqual([0, 255, 0])
    expect(Array.from(original.slice(0, 3))).toEqual([10, 20, 30])
  })
})

describe('peelExteriorStudioKeep', () => {
  it('removes border-attached studio KEEP without eating dark garment', () => {
    const w = 32
    const h = 32
    const mask = createMaskBuffer(w, h, 0)
    const rgba = new Uint8ClampedArray(w * h * 4)
    // Studio card
    for (let i = 0; i < w * h; i += 1) {
      rgba[i * 4] = 230
      rgba[i * 4 + 1] = 230
      rgba[i * 4 + 2] = 230
      rgba[i * 4 + 3] = 255
    }
    // Dark garment body
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        const i = y * w + x
        rgba[i * 4] = 20
        rgba[i * 4 + 1] = 20
        rgba[i * 4 + 2] = 20
        mask.data[i] = 255
      }
    }
    // Angular studio slab attached on the left (false FG)
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    const image = {
      width: w,
      height: h,
      data: rgba,
      colorSpace: 'srgb',
    } as ImageData
    peelExteriorStudioKeep(mask, image, 40, 40)
    // Studio slab should be mostly gone
    let slab = 0
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        if (mask.data[y * w + x]! >= 128) slab += 1
      }
    }
    expect(slab).toBeLessThan(8)
    // Dark garment core remains
    expect(mask.data[16 * w + 16]).toBe(255)
  })
})
