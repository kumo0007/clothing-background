import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer } from '../createMask'
import { BIREFNET_INPUT_SIZE } from './constants'

/** Numerically stable sigmoid. */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  }
  const z = Math.exp(x)
  return z / (1 + z)
}

/**
 * Convert model logits (or probabilities) at model resolution into a soft
 * alpha MaskPixelBuffer at the original image size.
 *
 * Polarity: 255 = KEEP garment, 0 = background, gray = soft edge.
 */
export function logitsToMaskBuffer(
  logits: Float32Array | Float16Array | number[],
  modelWidth: number,
  modelHeight: number,
  targetWidth: number,
  targetHeight: number,
  options: { alreadyProbability?: boolean } = {},
): MaskPixelBuffer {
  if (modelWidth < 1 || modelHeight < 1) {
    throw new Error('BiRefNet postprocess: invalid model dimensions.')
  }
  if (targetWidth < 1 || targetHeight < 1) {
    throw new Error('BiRefNet postprocess: invalid target dimensions.')
  }
  const expected = modelWidth * modelHeight
  if (logits.length < expected) {
    throw new Error(
      `BiRefNet postprocess: logits length ${logits.length} < ${expected}.`,
    )
  }

  // Validate finite values; replace non-finite with 0 logit (alpha→0.5) then clamp.
  const alpha = new Float32Array(expected)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < expected; i += 1) {
    let v = Number(logits[i])
    if (!Number.isFinite(v)) v = 0
    const p = options.alreadyProbability ? v : sigmoid(v)
    const clamped = Math.min(1, Math.max(0, p))
    alpha[i] = clamped
    if (clamped < min) min = clamped
    if (clamped > max) max = clamped
  }

  // Degenerate all-zero / all-one often means a broken session — still return a
  // mask, but callers should treat empty KEEP as failure.
  void min
  void max

  if (modelWidth === targetWidth && modelHeight === targetHeight) {
    const mask = createMaskBuffer(targetWidth, targetHeight, 0)
    for (let i = 0; i < expected; i += 1) {
      mask.data[i] = Math.round(alpha[i]! * 255)
    }
    return mask
  }

  return bilinearResizeAlpha(
    alpha,
    modelWidth,
    modelHeight,
    targetWidth,
    targetHeight,
  )
}

function bilinearResizeAlpha(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): MaskPixelBuffer {
  const mask = createMaskBuffer(dstW, dstH, 0)
  const scaleX = srcW / dstW
  const scaleY = srcH / dstH
  for (let y = 0; y < dstH; y += 1) {
    const sy = (y + 0.5) * scaleY - 0.5
    const y0 = Math.floor(sy)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0
    const cy0 = Math.min(srcH - 1, Math.max(0, y0))
    for (let x = 0; x < dstW; x += 1) {
      const sx = (x + 0.5) * scaleX - 0.5
      const x0 = Math.floor(sx)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0
      const cx0 = Math.min(srcW - 1, Math.max(0, x0))
      const v00 = src[cy0 * srcW + cx0]!
      const v10 = src[cy0 * srcW + x1]!
      const v01 = src[y1 * srcW + cx0]!
      const v11 = src[y1 * srcW + x1]!
      const v =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy
      mask.data[y * dstW + x] = Math.round(Math.min(1, Math.max(0, v)) * 255)
    }
  }
  return mask
}

export function countKeepPixels(mask: MaskPixelBuffer, thr = 128): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= thr) n += 1
  }
  return n
}

export function assertUsableMask(mask: MaskPixelBuffer): void {
  const keep = countKeepPixels(mask)
  if (keep < 1) {
    throw new Error(
      'BiRefNet produced an empty KEEP mask (no garment pixels). Treating as inference failure.',
    )
  }
  if (keep === mask.data.length) {
    // Entire frame KEEP is suspicious for product photography but can be valid
    // for fill-the-frame crops — do not throw; diagnostics will flag review.
  }
}

/**
 * Detect broken EP output (seen on some WebGPU adapters): all logits strongly
 * negative / tiny dynamic range → sigmoid KEEP ≈ 0 everywhere.
 */
export function logitsLookDegenerate(
  logits: Float32Array | number[],
  sample = 4096,
): boolean {
  const n = Math.min(logits.length, sample)
  if (n < 1) return true
  let min = Infinity
  let max = -Infinity
  let finite = 0
  const step = Math.max(1, Math.floor(logits.length / n))
  for (let i = 0; i < logits.length; i += step) {
    const v = Number(logits[i])
    if (!Number.isFinite(v)) continue
    finite += 1
    if (v < min) min = v
    if (v > max) max = v
  }
  if (finite < 8) return true
  // WebGPU failure mode observed: all logits strongly negative / tiny range below 0.
  if (max <= 0 && min < -0.5) return true
  if (max - min < 0.05 && max <= 0.05) return true
  return false
}

export function defaultModelHw(): { width: number; height: number } {
  return { width: BIREFNET_INPUT_SIZE, height: BIREFNET_INPUT_SIZE }
}
