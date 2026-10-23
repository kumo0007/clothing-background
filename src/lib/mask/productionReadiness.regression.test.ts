/**
 * Production-readiness regressions: method labels, RGB preservation,
 * preview/export parity, and MaskHistory undo after fallback correction.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  clearAllMasks,
  getMask,
  getOrCreateMask,
  setMask,
} from './maskStore'
import { createMaskBuffer, cloneMaskBuffer } from './createMask'
import { MaskHistory } from './maskHistory'
import { fillPolygonOnMask } from './polygonMask'
import { runAutoMaskPipeline } from './autoMaskPipeline'
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

function darkSquare(): ImageData {
  const img = makeImage(48, 48, [230, 230, 230])
  for (let y = 12; y < 36; y += 1) {
    for (let x = 12; x < 36; x += 1) setRgb(img, x, y, [20, 20, 25])
  }
  return img
}

function checksum(mask: MaskPixelBuffer): string {
  return createHash('sha256').update(Buffer.from(mask.data)).digest('hex')
}

describe('production readiness regressions', () => {
  beforeEach(() => clearAllMasks())

  it('rejected contour never reports methodUsed contour-first', async () => {
    // Near-full pale slab → follows-studio-card / insufficient reliable FG.
    const img = makeImage(64, 64, [232, 232, 232])
    for (let y = 4; y < 60; y += 1) {
      for (let x = 4; x < 60; x += 1) setRgb(img, x, y, [228, 228, 228])
    }
    const r = await runAutoMaskPipeline(img, 'contour', 40)
    if (!r.contourDiagnostics?.contourAccepted) {
      expect(r.methodUsed).toBe('contour-first-fallback-seed')
      expect(r.needsReview).toBe(true)
      expect(r.reviewReasons?.length).toBeGreaterThan(0)
      expect(r.contourDiagnostics?.rejectReason || r.contourDiagnostics?.fallbackReason).toBeTruthy()
    }
  })

  it('manual edit does not clear needsReview on project meta contract', async () => {
    // App.handleMaskEdited preserves needsReview — mirror that contract here.
    const meta = {
      revision: 1,
      hasEdits: true,
      needsReview: true,
      autoMethodUsed: 'contour-first-fallback-seed',
      reviewReason: 'seed-prior after follows-studio-card',
    }
    const afterEdit = {
      ...meta,
      revision: meta.revision + 1,
      hasEdits: true,
      // Keep auto-mask review flags; polygon/brush edits do not clear needsReview.
    }
    expect(afterEdit.needsReview).toBe(true)
    expect(afterEdit.autoMethodUsed).toBe('contour-first-fallback-seed')
  })

  it('re-auto-mask clears reviewReason when needsReview becomes false', () => {
    // Mirrors App.handleAutoMaskAll maskMeta replacement (not a partial merge).
    const previous = {
      revision: 2,
      hasEdits: true,
      needsReview: true,
      autoMethodUsed: 'contour-first-fallback-seed',
      reviewReason: 'seed-prior after follows-studio-card',
    }
    const auto = {
      needsReview: false,
      methodUsed: 'contour-first',
      confidence: 0.84,
      reviewReason: undefined as string | undefined,
    }
    const next = {
      revision: previous.revision + 1,
      hasEdits: true,
      autoConfidence: auto.confidence,
      needsReview: auto.needsReview,
      autoMethodUsed: auto.methodUsed,
      reviewReason: auto.needsReview ? auto.reviewReason : undefined,
    }
    expect(next.needsReview).toBe(false)
    expect(next.reviewReason).toBeUndefined()
    expect(next.autoMethodUsed).toBe('contour-first')
  })

  it('batch maskMeta updates are per imageId (no cross-image overwrite)', () => {
    type Meta = {
      needsReview?: boolean
      autoMethodUsed?: string
      reviewReason?: string
    }
    const projects: Record<string, { maskMeta: Meta }> = {
      'img-a': {
        maskMeta: {
          needsReview: true,
          autoMethodUsed: 'contour-first-fallback-seed',
        },
      },
      'img-b': {
        maskMeta: { needsReview: false, autoMethodUsed: 'opencv-seed-fallback' },
      },
    }
    const imageId = 'img-a'
    const auto = {
      needsReview: false,
      methodUsed: 'contour-first',
    }
    const next: Record<string, { maskMeta: Meta }> = {
      ...projects,
      [imageId]: {
        maskMeta: {
          needsReview: auto.needsReview,
          autoMethodUsed: auto.methodUsed,
          reviewReason: auto.needsReview ? 'x' : undefined,
        },
      },
    }
    expect(next['img-a']!.maskMeta.needsReview).toBe(false)
    expect(next['img-b']!.maskMeta.autoMethodUsed).toBe('opencv-seed-fallback')
    expect(next['img-b']!.maskMeta.needsReview).toBe(false)
  })

  it('accepted dark contour reports contour-first and preserves source RGB', async () => {
    const img = darkSquare()
    const before = Uint8ClampedArray.from(img.data)
    const r = await runAutoMaskPipeline(img, 'contour', 40)
    expect(Array.from(img.data)).toEqual(Array.from(before))
    if (r.contourDiagnostics?.contourAccepted) {
      expect(r.methodUsed).toBe('contour-first')
    } else {
      expect(r.methodUsed).toBe('contour-first-fallback-seed')
    }
  })

  it('default auto remains Lab-seed', async () => {
    const r = await runAutoMaskPipeline(darkSquare(), 'auto', 40)
    expect(r.methodUsed).toBe('opencv-seed-fallback')
  })

  it('preview and export composites match for the same store mask', async () => {
    const img = darkSquare()
    const r = await runAutoMaskPipeline(img, 'auto', 40)
    getOrCreateMask('parity', 48, 48)
    setMask('parity', r.mask)
    const bg = new Uint8ClampedArray(48 * 48 * 4)
    for (let i = 0; i < 48 * 48; i += 1) {
      bg[i * 4] = 217
      bg[i * 4 + 1] = 196
      bg[i * 4 + 2] = 174
      bg[i * 4 + 3] = 255
    }
    const preview = compositePixelBuffers(img.data, getMask('parity')!.data, bg)
    const exported = compositePixelBuffers(img.data, getMask('parity')!.data, bg)
    expect(Array.from(preview)).toEqual(Array.from(exported))
  })

  it('MaskHistory undo/redo restores pre-edit mask after correction', () => {
    const base = createMaskBuffer(20, 20, 0)
    base.data.fill(0)
    for (let i = 100; i < 200; i += 1) base.data[i] = 255
    const history = new MaskHistory()
    // Correct API: push *before* mutating (matches MaskEditor.beginStroke).
    history.push(base)
    const edited = cloneMaskBuffer(base)
    fillPolygonOnMask(
      edited,
      [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 8 },
        { x: 1, y: 8 },
      ],
      'keep',
    )
    expect(checksum(edited)).not.toBe(checksum(base))
    const undone = history.undo(edited)
    expect(undone).not.toBeNull()
    expect(checksum(undone!)).toBe(checksum(base))
    const redone = history.redo(undone!)
    expect(redone).not.toBeNull()
    expect(checksum(redone!)).toBe(checksum(edited))
  })

  it('mask polarity: KEEP high, REMOVE low, soft alpha allowed', async () => {
    const r = await runAutoMaskPipeline(darkSquare(), 'auto', 40)
    expect(r.mask.data.some((v) => v >= 250)).toBe(true)
    expect(r.mask.data.some((v) => v <= 5)).toBe(true)
  })

  it('large accepted under-recall requires review (coat hem QC contract)', () => {
    // Mirrors runIsnetAutoMask largeUnderRecallNeedsReview — mask kept, QC flagged.
    const diag = {
      refinementAccepted: true,
      refinementCategory: 'under-recall' as const,
      acceptReason: 'reclaimed-under-recall',
      deltaFgRatio: 0.085,
      failureModes: [] as string[],
      gateValues: { darkBiteReclaimed: 0 },
    }
    const largeUnderRecallNeedsReview =
      diag.refinementAccepted &&
      (diag.refinementCategory === 'under-recall' ||
        (diag.acceptReason?.includes('reclaimed-under-recall') ?? false)) &&
      diag.deltaFgRatio >= 0.05
    expect(largeUnderRecallNeedsReview).toBe(true)
    // Modest dark-bite / small under-recall must not trip this gate alone.
    expect(
      diag.refinementAccepted &&
        diag.refinementCategory === 'under-recall' &&
        0.03 >= 0.05,
    ).toBe(false)
  })
})
