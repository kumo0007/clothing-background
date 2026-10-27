import type { MaskPixelBuffer } from '../../types/mask'

/** Fraction of pixels at/above the solid KEEP threshold (default 128). */
export function maskKeepRatio(
  mask: MaskPixelBuffer,
  threshold = 128,
): number {
  const total = mask.data.length
  if (total < 1) return 0
  let keep = 0
  for (let i = 0; i < total; i += 1) {
    if (mask.data[i]! >= threshold) keep += 1
  }
  return keep / total
}

/**
 * A usable auto-mask should keep a meaningful subject. Near-zero KEEP would
 * paint an empty transparent canvas (checkerboard only) in the gallery preview.
 */
export function isUsableKeepMask(
  mask: MaskPixelBuffer,
  minRatio = 0.002,
): boolean {
  return maskKeepRatio(mask) >= minRatio
}
