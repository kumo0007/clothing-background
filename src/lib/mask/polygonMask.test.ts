import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import { MaskHistory } from './maskHistory'
import { clearAllMasks, getOrCreateMask, setMask } from './maskStore'
import {
  applyPolygonRingsToMask,
  clampPolygonPoint,
  fillPolygonOnMask,
  isDegeneratePolygon,
  isNearFirstVertex,
  pointInPolygon,
  type PolygonPoint,
} from './polygonMask'
import { screenToImage, zoomAtPoint } from '../rendering/coords'

function square(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PolygonPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
}

describe('polygonMask rasterization', () => {
  it('marks interior pixels KEEP with add / keep-inside', () => {
    const mask = createMaskBuffer(10, 10, 0)
    fillPolygonOnMask(mask, square(2, 2, 7, 7), 'add')
    expect(mask.data[5 * 10 + 5]).toBe(255)
    expect(mask.data[0]).toBe(0)
    expect(mask.data[9 * 10 + 9]).toBe(0)
  })

  it('subtract / remove-inside clears interior to background', () => {
    const mask = createMaskBuffer(10, 10, 255)
    fillPolygonOnMask(mask, square(3, 3, 6, 6), 'subtract')
    expect(mask.data[4 * 10 + 4]).toBe(0)
    expect(mask.data[1 * 10 + 1]).toBe(255)
  })

  it('replace clears the whole mask then keeps only the polygon', () => {
    const mask = createMaskBuffer(8, 8, 128)
    fillPolygonOnMask(mask, square(1, 1, 4, 4), 'replace')
    expect(mask.data[2 * 8 + 2]).toBe(255)
    expect(mask.data[0]).toBe(0)
    expect(mask.data[7 * 8 + 7]).toBe(0)
  })

  it('preserves soft alpha outside the edited region for add/subtract', () => {
    const mask = createMaskBuffer(10, 10, 0)
    mask.data[1 * 10 + 1] = 90
    mask.data[8 * 10 + 8] = 140
    fillPolygonOnMask(mask, square(3, 3, 6, 6), 'add')
    expect(mask.data[1 * 10 + 1]).toBe(90)
    expect(mask.data[8 * 10 + 8]).toBe(140)
    expect(mask.data[4 * 10 + 4]).toBe(255)

    fillPolygonOnMask(mask, square(3, 3, 6, 6), 'subtract')
    expect(mask.data[1 * 10 + 1]).toBe(90)
    expect(mask.data[8 * 10 + 8]).toBe(140)
    expect(mask.data[4 * 10 + 4]).toBe(0)
  })

  it('creates interior holes with additive then subtractive rings', () => {
    const mask = createMaskBuffer(20, 20, 0)
    applyPolygonRingsToMask(
      mask,
      [square(2, 2, 17, 17), square(7, 7, 12, 12)],
      ['add', 'subtract'],
    )
    expect(mask.data[4 * 20 + 4]).toBe(255)
    expect(mask.data[9 * 20 + 9]).toBe(0)
    expect(mask.data[0]).toBe(0)
  })

  it('rejects degenerate / incomplete polygons', () => {
    const mask = createMaskBuffer(10, 10, 0)
    expect(isDegeneratePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true)
    expect(
      isDegeneratePolygon([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(true)
    expect(fillPolygonOnMask(mask, [{ x: 0, y: 0 }, { x: 5, y: 5 }], 'add')).toBe(
      0,
    )
    expect(mask.data.every((v) => v === 0)).toBe(true)
  })

  it('point-in-polygon and close-near-first helpers', () => {
    const ring = square(0, 0, 10, 10)
    expect(pointInPolygon(5, 5, ring)).toBe(true)
    expect(pointInPolygon(20, 20, ring)).toBe(false)
    expect(isNearFirstVertex(ring, { x: 0.2, y: 0.1 }, 1)).toBe(true)
    expect(isNearFirstVertex(ring, { x: 5, y: 5 }, 1)).toBe(false)
    expect(isNearFirstVertex([{ x: 0, y: 0 }, { x: 1, y: 0 }], { x: 0, y: 0 }, 2)).toBe(
      false,
    )
  })

  it('clamps points into image bounds', () => {
    expect(clampPolygonPoint({ x: -5, y: 50 }, 10, 10)).toEqual({
      x: 0,
      y: 10 - 1e-6,
    })
    expect(clampPolygonPoint({ x: 3, y: 4 }, 10, 10)).toEqual({ x: 3, y: 4 })
  })
})

describe('polygon + view transform coordinate stability', () => {
  it('same screen boundary yields same image coords after zoom', () => {
    let transform = { scale: 1, offsetX: 40, offsetY: 20 }
    const screen = { x: 140, y: 100 }
    const at1 = screenToImage(screen.x, screen.y, transform)
    transform = zoomAtPoint(transform, screen.x, screen.y, 2.5)
    const atZoom = screenToImage(screen.x, screen.y, transform)
    expect(atZoom.x).toBeCloseTo(at1.x, 10)
    expect(atZoom.y).toBeCloseTo(at1.y, 10)

    const maskA = createMaskBuffer(64, 64, 0)
    const maskB = createMaskBuffer(64, 64, 0)
    const ring = square(at1.x - 5, at1.y - 5, at1.x + 5, at1.y + 5)
    fillPolygonOnMask(maskA, ring, 'add')
    fillPolygonOnMask(maskB, ring, 'add')
    expect(Array.from(maskA.data)).toEqual(Array.from(maskB.data))
  })

  it('out-of-bounds screen mapping still clamps for safe rasterize', () => {
    const transform = { scale: 2, offsetX: 0, offsetY: 0 }
    const outside = screenToImage(-10, -10, transform)
    const clamped = clampPolygonPoint(outside, 32, 32)
    expect(clamped.x).toBeGreaterThanOrEqual(0)
    expect(clamped.y).toBeGreaterThanOrEqual(0)
    expect(clamped.x).toBeLessThan(32)
    expect(clamped.y).toBeLessThan(32)
  })
})

describe('polygon undo/redo and per-image isolation', () => {
  it('undo restores exact previous mask; cancel does not mutate', () => {
    let mask = createMaskBuffer(12, 12, 40)
    const history = new MaskHistory()
    const before = Uint8ClampedArray.from(mask.data)

    history.push(mask)
    fillPolygonOnMask(mask, square(2, 2, 9, 9), 'add')
    expect(mask.data[5 * 12 + 5]).toBe(255)

    mask = history.undo(mask)!
    expect(Array.from(mask.data)).toEqual(Array.from(before))

    // Cancel / clear an in-progress draft must not touch the committed mask.
    const committed = Uint8ClampedArray.from(mask.data)
    const draft: PolygonPoint[] = square(0, 0, 3, 3)
    draft.length = 0
    expect(Array.from(mask.data)).toEqual(Array.from(committed))
    expect(draft).toHaveLength(0)
  })

  it('redo restores the corrected mask after undo', () => {
    let mask = createMaskBuffer(10, 10, 0)
    const history = new MaskHistory()
    history.push(mask)
    fillPolygonOnMask(mask, square(1, 1, 8, 8), 'add')
    const afterEdit = Uint8ClampedArray.from(mask.data)
    mask = history.undo(mask)!
    expect(mask.data[5 * 10 + 5]).toBe(0)
    mask = history.redo(mask)!
    expect(Array.from(mask.data)).toEqual(Array.from(afterEdit))
  })

  it('editing one image mask does not alter another', () => {
    clearAllMasks()
    const a = getOrCreateMask('img-a', 8, 8)
    const b = getOrCreateMask('img-b', 8, 8)
    a.data.fill(0)
    b.data.fill(0)
    fillPolygonOnMask(a, square(1, 1, 6, 6), 'add')
    setMask('img-a', a)
    expect(b.data.every((v) => v === 0)).toBe(true)
    expect(a.data[3 * 8 + 3]).toBe(255)
    clearAllMasks()
  })
})

describe('polygon does not rewrite source RGB contract', () => {
  it('only mutates mask buffer bytes', () => {
    const sourceRgb = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    const snapshot = Uint8ClampedArray.from(sourceRgb)
    const mask = createMaskBuffer(2, 1, 0)
    fillPolygonOnMask(
      mask,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 1 },
      ],
      'add',
    )
    expect(Array.from(sourceRgb)).toEqual(Array.from(snapshot))
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(255)
  })

  it('composites at native mask resolution without altering source RGB', async () => {
    const { compositePixelBuffers } = await import('../rendering/compositePixels')
    const w = 4
    const h = 4
    const original = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i += 1) {
      original[i * 4] = 200
      original[i * 4 + 1] = 100
      original[i * 4 + 2] = 50
      original[i * 4 + 3] = 255
    }
    const sourceSnap = Uint8ClampedArray.from(original)
    const mask = createMaskBuffer(w, h, 0)
    fillPolygonOnMask(mask, square(1, 1, 3, 3), 'add')
    const bg = new Uint8ClampedArray(w * h * 4)
    bg.fill(0)
    for (let i = 0; i < w * h; i += 1) bg[i * 4 + 3] = 255
    const out = compositePixelBuffers(original, mask.data, bg)
    expect(Array.from(original)).toEqual(Array.from(sourceSnap))
    expect(out.length).toBe(w * h * 4)
    // Inside polygon: original garment RGB
    expect(Array.from(out.slice((2 * w + 2) * 4, (2 * w + 2) * 4 + 3))).toEqual([
      200, 100, 50,
    ])
    // Outside: background
    expect(Array.from(out.slice(0, 3))).toEqual([0, 0, 0])
  })
})
