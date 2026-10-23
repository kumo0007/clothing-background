/**
 * Segmentation quality metrics vs independent reference labels.
 * Soft alpha is scored separately from binary KEEP/REMOVE.
 */

import type { MaskPixelBuffer } from '../../../types/mask'
import { REF_BG, REF_FG, REF_UNCERTAIN } from './referenceMask'

export type BinaryMetrics = {
  /** Scored pixels only (excludes REF_UNCERTAIN). */
  scoredPixels: number
  fgPrecision: number | null
  fgRecall: number | null
  bgPrecision: number | null
  bgRecall: number | null
  iou: number | null
  dice: number | null
  /** Fraction of definite-FG pixels incorrectly REMOVE/soft. */
  garmentMissRate: number | null
  /** Fraction of definite-BG pixels incorrectly KEEP. */
  bgContaminationRate: number | null
}

export type BoundaryMetrics = {
  /** Definite-FG pixels within `tol` of a definite-BG pixel (edge band). */
  edgeBandPixels: number
  /** Correct binary decisions in the edge band. */
  edgeAccuracy: number | null
  /** Mean |predAlpha - expected| on edge band (expected 0 or 1). */
  softAlphaMae: number | null
}

export type HoleMetrics = {
  /** Pred KEEP bright-neutral components enclosed by definite-FG dark walls. */
  internalHoleErrorPixels: number
  internalHoleComponents: number
}

function safeDiv(num: number, den: number): number | null {
  if (den <= 0) return null
  return +(num / den).toFixed(4)
}

/** Binary KEEP if mask >= 128 (soft treated as keep for classification). */
export function isPredKeep(v: number): boolean {
  return v >= 128
}

export function computeBinaryMetrics(
  pred: MaskPixelBuffer,
  ref: MaskPixelBuffer,
): BinaryMetrics {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  let scored = 0

  for (let i = 0; i < ref.data.length; i += 1) {
    const r = ref.data[i]!
    if (r === REF_UNCERTAIN) continue
    scored += 1
    const keep = isPredKeep(pred.data[i]!)
    if (r === REF_FG) {
      if (keep) tp += 1
      else fn += 1
    } else if (r === REF_BG) {
      if (keep) fp += 1
      else tn += 1
    }
  }

  const iouDen = tp + fp + fn
  const diceDen = 2 * tp + fp + fn
  return {
    scoredPixels: scored,
    fgPrecision: safeDiv(tp, tp + fp),
    fgRecall: safeDiv(tp, tp + fn),
    bgPrecision: safeDiv(tn, tn + fn),
    bgRecall: safeDiv(tn, tn + fp),
    iou: safeDiv(tp, iouDen),
    dice: safeDiv(2 * tp, diceDen),
    garmentMissRate: safeDiv(fn, tp + fn),
    bgContaminationRate: safeDiv(fp, tn + fp),
  }
}

export function computeBoundaryMetrics(
  pred: MaskPixelBuffer,
  ref: MaskPixelBuffer,
  tol = 2,
): BoundaryMetrics {
  const { width, height } = ref
  const edge = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (ref.data[i] !== REF_FG) continue
      let nearBg = false
      for (let dy = -tol; dy <= tol && !nearBg; dy += 1) {
        for (let dx = -tol; dx <= tol; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (ref.data[ny * width + nx] === REF_BG) {
            nearBg = true
            break
          }
        }
      }
      if (nearBg) edge[i] = 1
    }
  }

  let edgeBandPixels = 0
  let correct = 0
  let softMaeSum = 0
  for (let i = 0; i < edge.length; i += 1) {
    if (!edge[i]) continue
    edgeBandPixels += 1
    const expectedKeep = ref.data[i] === REF_FG
    const p = pred.data[i]!
    const predKeep = isPredKeep(p)
    if (predKeep === expectedKeep) correct += 1
    const expectedAlpha = expectedKeep ? 1 : 0
    softMaeSum += Math.abs(p / 255 - expectedAlpha)
  }

  return {
    edgeBandPixels,
    edgeAccuracy: safeDiv(correct, edgeBandPixels),
    softAlphaMae: safeDiv(softMaeSum, edgeBandPixels),
  }
}

/**
 * Approximate internal-hole error: pred KEEP bright pixels that sit inside
 * a region whose reference neighbors are mostly definite FG (dark walls) and
 * are not themselves definite FG. Used as a handle-opening proxy.
 */
export function computeInternalHoleError(
  pred: MaskPixelBuffer,
  ref: MaskPixelBuffer,
  imageData: ImageData,
): HoleMetrics {
  const { width, height } = pred
  const visited = new Uint8Array(width * height)
  let internalHoleErrorPixels = 0
  let internalHoleComponents = 0

  const isBrightPredKeep = (i: number): boolean => {
    if (pred.data[i]! < 160) return false
    if (ref.data[i] === REF_FG) return false
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const c = Math.max(r, g, b) - Math.min(r, g, b)
    return L >= 150 && c <= 32
  }

  for (let start = 0; start < pred.data.length; start += 1) {
    if (visited[start] || !isBrightPredKeep(start)) {
      visited[start] = 1
      continue
    }
    const component: number[] = []
    const queue = [start]
    visited[start] = 1
    let touchesBorder = false
    let head = 0
    while (head < queue.length) {
      const i = queue[head++]!
      component.push(i)
      const x = i % width
      const y = (i / width) | 0
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true
      }
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (n < 0 || visited[n]) continue
        if (!isBrightPredKeep(n)) continue
        visited[n] = 1
        queue.push(n)
      }
    }
    if (touchesBorder || component.length < 4) continue

    const inComp = new Set(component)
    let darkRefWall = 0
    let edge = 0
    for (const i of component) {
      const x = i % width
      const y = (i / width) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (n < 0 || inComp.has(n)) continue
        edge += 1
        const o = n * 4
        const r = imageData.data[o]!
        const g = imageData.data[o + 1]!
        const b = imageData.data[o + 2]!
        const L = 0.299 * r + 0.587 * g + 0.114 * b
        // Prefer reference FG walls; also accept dark predicted KEEP walls so
        // handle openings are counted even when ref marks the wall uncertain.
        if (L < 95 && (ref.data[n] === REF_FG || pred.data[n]! >= 128)) {
          darkRefWall += 1
        }
      }
    }
    if (edge > 0 && darkRefWall / edge >= 0.35) {
      internalHoleErrorPixels += component.length
      internalHoleComponents += 1
    }
  }

  return { internalHoleErrorPixels, internalHoleComponents }
}
