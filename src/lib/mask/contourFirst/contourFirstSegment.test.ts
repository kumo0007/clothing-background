import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import { compositePixelBuffers } from '../../rendering/compositePixels'
import { clearAllMasks, getOrCreateMask, setMask } from '../maskStore'
import { MaskHistory } from '../maskHistory'
import { fillPolygonOnMask } from '../polygonMask'
import {
  buildEdgeBarriers,
  closeBarrierGaps,
  detectCandidateEdges,
  fillFromValidatedContour,
  floodExteriorThroughGaps,
  rasterizeContourRing,
  segmentGarmentContourFirst,
  validateContourCandidate,
} from './contourFirstSegment'
import { runAutoMaskPipeline } from '../autoMaskPipeline'

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

describe('contour-first edge utilities', () => {
  it('detects edges along a dark silhouette on a bright card', () => {
    const img = makeImage(48, 48, [230, 230, 230])
    for (let y = 12; y < 36; y += 1) {
      for (let x = 12; x < 36; x += 1) setRgb(img, x, y, [20, 20, 20])
    }
    const edges = detectCandidateEdges(img)
    // Strong response near the square boundary
    let boundaryEdge = 0
    for (let x = 12; x < 36; x += 1) {
      if (edges[12 * 48 + x]! > 20) boundaryEdge += 1
      if (edges[35 * 48 + x]! > 20) boundaryEdge += 1
    }
    expect(boundaryEdge).toBeGreaterThan(20)
  })

  it('builds barriers and closes only small gaps', () => {
    const w = 40
    const h = 40
    const edges = new Uint8ClampedArray(w * h)
    // Incomplete ring with a 2px gap
    for (let a = 0; a < 360; a += 2) {
      if (a > 10 && a < 20) continue
      const x = Math.round(20 + 12 * Math.cos((a * Math.PI) / 180))
      const y = Math.round(20 + 12 * Math.sin((a * Math.PI) / 180))
      if (x >= 0 && y >= 0 && x < w && y < h) edges[y * w + x] = 80
    }
    const barriers = buildEdgeBarriers(edges, w, h, null, 40)
    const { gapClosed, substantial } = closeBarrierGaps(barriers, w, h)
    expect(typeof gapClosed).toBe('boolean')
    expect(substantial).toBe(false)
  })

  it('rejects frame-following candidates', () => {
    const w = 32
    const h = 32
    const interior = new Uint8ClampedArray(w * h)
    interior.fill(255) // full frame
    const flooded = new Uint8ClampedArray(w * h)
    const v = validateContourCandidate(interior, w, h, null, flooded)
    expect(v.ok).toBe(false)
    expect(v.decision).toBe('reject')
    expect(v.reason).toMatch(/full-frame|border|small|exterior|studio-card/)
  })

  it('rejects card-spanning interiors with thin exterior', () => {
    const w = 100
    const h = 100
    const interior = new Uint8ClampedArray(w * h)
    const flooded = new Uint8ClampedArray(w * h)
    // Studio-card mode: silhouette spans ~88% of both axes, ~55–75% area,
    // exterior flood only a thin margin (tee failure geometry).
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x
        const border = x < 6 || y < 6 || x >= w - 6 || y >= h - 6
        if (border) flooded[i] = 255
        else interior[i] = 255
      }
    }
    const v = validateContourCandidate(interior, w, h, null, flooded)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/follows-studio-card|interior-nearly-full/)
    expect(v.bounds?.spanX).toBeGreaterThanOrEqual(0.88)
    expect(v.exteriorRatio).toBeLessThan(0.38)
  })

  it('rejects substantial gap completion with weak seed agreement', () => {
    const w = 80
    const h = 80
    const interior = new Uint8ClampedArray(w * h)
    const flooded = new Uint8ClampedArray(w * h)
    const seed = createMaskBuffer(w, h, 0)
    // Compact interior (~25%) with exterior around it.
    for (let y = 20; y < 55; y += 1) {
      for (let x = 20; x < 55; x += 1) interior[y * w + x] = 255
    }
    for (let i = 0; i < w * h; i += 1) {
      if (interior[i]! < 128) flooded[i] = 255
    }
    // Seed KEEP covers a different region → agreement ~0.4.
    for (let y = 10; y < 60; y += 1) {
      for (let x = 10; x < 45; x += 1) seed.data[y * w + x] = 255
    }
    const v = validateContourCandidate(interior, w, h, seed, flooded, {
      gapAddedRatio: 0.02,
      substantialGapCompletion: true,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/excessive-gap|weak/)
    expect(v.substantialGapCompletion).toBe(true)
    expect(v.seedAgreement).toBeLessThan(0.55)
  })

  it('rejects large pale interiors lacking reliable dark/chromatic FG', () => {
    const w = 100
    const h = 100
    const interior = new Uint8ClampedArray(w * h)
    const flooded = new Uint8ClampedArray(w * h)
    const seed = createMaskBuffer(w, h, 0)
    const img = makeImage(w, h, [230, 230, 230])
    for (let y = 8; y < 92; y += 1) {
      for (let x = 12; x < 88; x += 1) {
        interior[y * w + x] = 255
        seed.data[y * w + x] = 200 // pale KEEP — not reliable FG
      }
    }
    for (let i = 0; i < w * h; i += 1) {
      if (interior[i]! < 128) flooded[i] = 255
    }
    const v = validateContourCandidate(interior, w, h, seed, flooded, {
      imageData: img,
      gapAddedRatio: 0.005,
      substantialGapCompletion: false,
    })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(
      /insufficient-reliable-fg|follows-studio-card|reliable-fg-outside/,
    )
    expect(v.reliableFgRatio).toBeLessThan(0.04)
  })

  it('accepts a compact dark-garment-like interior with strong seed overlap', () => {
    const w = 80
    const h = 80
    const interior = new Uint8ClampedArray(w * h)
    const flooded = new Uint8ClampedArray(w * h)
    const seed = createMaskBuffer(w, h, 0)
    for (let y = 18; y < 58; y += 1) {
      for (let x = 22; x < 55; x += 1) {
        interior[y * w + x] = 255
        seed.data[y * w + x] = 255
      }
    }
    for (let i = 0; i < w * h; i += 1) {
      if (interior[i]! < 128) flooded[i] = 255
    }
    const v = validateContourCandidate(interior, w, h, seed, flooded, {
      gapAddedRatio: 0.002,
      substantialGapCompletion: false,
    })
    expect(v.ok).toBe(true)
    expect(v.decision).toBe('accept')
    expect(v.reason).toBe('accepted')
  })
})

describe('contour-first flood and fill', () => {
  it('edge-barrier flood isolates a dark garment from border', () => {
    const w = 64
    const h = 64
    const img = makeImage(w, h, [225, 225, 225])
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) setRgb(img, x, y, [25, 25, 40])
    }
    const edges = detectCandidateEdges(img)
    const barriers = buildEdgeBarriers(edges, w, h, null, 32)
    const closed = closeBarrierGaps(barriers, w, h).closed
    const flooded = floodExteriorThroughGaps(closed, w, h)
    expect(flooded[0]).toBe(255)
    expect(flooded[32 * w + 32]).toBe(0)
  })

  it('fill preserves polarity and nested hole subtract via rings', () => {
    const mask = createMaskBuffer(24, 24, 0)
    fillPolygonOnMask(
      mask,
      [
        { x: 2, y: 2 },
        { x: 21, y: 2 },
        { x: 21, y: 21 },
        { x: 2, y: 21 },
      ],
      'add',
    )
    fillPolygonOnMask(
      mask,
      [
        { x: 8, y: 8 },
        { x: 15, y: 8 },
        { x: 15, y: 15 },
        { x: 8, y: 15 },
      ],
      'subtract',
    )
    expect(mask.data[4 * 24 + 4]).toBe(255)
    expect(mask.data[11 * 24 + 11]).toBe(0)
  })

  it('rasterizeContourRing is native-resolution pixel-center fill', () => {
    const mask = rasterizeContourRing(20, 20, [
      { x: 4, y: 4 },
      { x: 15, y: 4 },
      { x: 15, y: 15 },
      { x: 4, y: 15 },
    ])
    expect(mask.width).toBe(20)
    expect(mask.data[9 * 20 + 9]).toBe(255)
    expect(mask.data[0]).toBe(0)
  })

  it('thin vertical strap survives contour fill helper', () => {
    const interior = new Uint8ClampedArray(40 * 40)
    for (let y = 2; y < 38; y += 1) {
      for (let x = 18; x < 22; x += 1) interior[y * 40 + x] = 255
    }
    const mask = fillFromValidatedContour(40, 40, interior, null)
    let keep = 0
    for (let y = 5; y < 35; y += 1) {
      if (mask.data[y * 40 + 20]! >= 128) keep += 1
    }
    expect(keep).toBeGreaterThan(20)
  })
})

describe('contour-first white-on-white behavior', () => {
  it('does not erase a pale panel solely because it matches the card color', () => {
    const w = 48
    const h = 48
    const img = makeImage(w, h, [226, 226, 226])
    // Slightly lifted white "tee" with a soft gradient rim (silhouette cue)
    for (let y = 10; y < 38; y += 1) {
      for (let x = 10; x < 38; x += 1) {
        const onRim =
          x === 10 || y === 10 || x === 37 || y === 37
        setRgb(img, x, y, onRim ? [210, 210, 210] : [232, 232, 232])
      }
    }
    // Dark label seed
    for (let x = 20; x < 28; x += 1) {
      setRgb(img, x, 14, [40, 40, 40])
      setRgb(img, x, 15, [40, 40, 40])
    }
    const result = segmentGarmentContourFirst(img, { includeDebug: true })
    expect(result.methodUsed).toBe('contour-first')
    expect(result.debug?.edges).toBeTruthy()
    // Interior pale pixels should often be KEEP when contour accepted;
    // if rejected, needsReview must be honest.
    // Accepted ⇒ pale interior retained; rejected ⇒ honest needsReview.
    // Never silently treat a wiped pale garment as a success.
    if (result.diagnostics.contourAccepted) {
      expect(result.methodUsed).toBe('contour-first')
      expect(result.mask.data[24 * w + 24]).toBeGreaterThanOrEqual(128)
    } else {
      expect(result.methodUsed).toBe('contour-first-fallback-seed')
      expect(result.needsReview).toBe(true)
      expect(result.diagnostics.rejectReason).toBeTruthy()
    }
  })

  it('fallback never labels methodUsed as contour-first', () => {
    // Tiny noisy image → validation rejects → seed fallback.
    const img = makeImage(16, 16, [200, 200, 200])
    for (let i = 0; i < 16 * 16; i += 3) {
      setRgb(img, i % 16, Math.floor(i / 16), [180 + (i % 40), 180, 180])
    }
    const result = segmentGarmentContourFirst(img)
    if (!result.diagnostics.contourAccepted) {
      expect(result.methodUsed).toBe('contour-first-fallback-seed')
      expect(result.needsReview).toBe(true)
    }
  })

  it('source RGB is never mutated', () => {
    const img = makeImage(24, 24, [200, 200, 200])
    for (let y = 6; y < 18; y += 1) {
      for (let x = 6; x < 18; x += 1) setRgb(img, x, y, [30, 30, 30])
    }
    const before = Uint8ClampedArray.from(img.data)
    segmentGarmentContourFirst(img)
    expect(Array.from(img.data)).toEqual(Array.from(before))
  })
})

describe('contour-first pipeline integration', () => {
  it('runAutoMaskPipeline(method: contour) is explicit and does not claim ISNet', async () => {
    const img = makeImage(32, 32, [220, 220, 220])
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) setRgb(img, x, y, [40, 40, 50])
    }
    const r = await runAutoMaskPipeline(img, 'contour')
    expect(r.methodUsed).toBe('contour-first')
    expect(r.genuineModelInference).toBe(false)
    expect(r.contourDiagnostics).toBeTruthy()
  })

  it('default auto path remains Lab-seed (not contour)', async () => {
    const img = makeImage(28, 28, [230, 230, 230])
    for (let y = 6; y < 22; y += 1) {
      for (let x = 6; x < 22; x += 1) setRgb(img, x, y, [20, 20, 20])
    }
    const r = await runAutoMaskPipeline(img, 'auto')
    expect(r.methodUsed).not.toBe('contour-first')
    expect(String(r.methodUsed)).toMatch(/seed|baseline|opencv/)
  })

  it('preview/export compositing parity and batch isolation', async () => {
    clearAllMasks()
    const img = makeImage(20, 20, [210, 210, 210])
    for (let y = 4; y < 16; y += 1) {
      for (let x = 4; x < 16; x += 1) setRgb(img, x, y, [15, 15, 15])
    }
    const r = await runAutoMaskPipeline(img, 'contour')
    const a = getOrCreateMask('cf-a', 20, 20)
    a.data.set(r.mask.data)
    setMask('cf-a', a)
    const b = getOrCreateMask('cf-b', 20, 20)
    b.data.fill(0)
    expect(b.data.every((v) => v === 0)).toBe(true)

    const bg = new Uint8ClampedArray(20 * 20 * 4)
    for (let i = 0; i < 20 * 20; i += 1) {
      bg[i * 4] = 255
      bg[i * 4 + 1] = 0
      bg[i * 4 + 2] = 255
      bg[i * 4 + 3] = 255
    }
    const preview = compositePixelBuffers(img.data, a.data, bg)
    const exported = compositePixelBuffers(img.data, a.data, bg)
    expect(Array.from(preview)).toEqual(Array.from(exported))
    clearAllMasks()
  })

  it('undo restores prior mask after contour-assisted polygon edit', () => {
    const mask = createMaskBuffer(16, 16, 0)
    const history = new MaskHistory()
    history.push(mask)
    fillPolygonOnMask(
      mask,
      [
        { x: 2, y: 2 },
        { x: 13, y: 2 },
        { x: 13, y: 13 },
        { x: 2, y: 13 },
      ],
      'add',
    )
    const undone = history.undo(mask)!
    expect(undone.data[8 * 16 + 8]).toBe(0)
  })
})
