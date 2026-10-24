/**
 * Convert a transparent foreground PNG (RGBA) into a MaskPixelBuffer.
 *
 * Polarity: alpha 255 = KEEP garment, 0 = background, gray = soft edge.
 * Never mutates source garment RGB — only derives the alpha mask.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { createMaskBuffer } from './createMask'

/** Extract alpha channel as a grayscale KEEP mask (same dimensions). */
export function extractAlphaMaskFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): MaskPixelBuffer {
  if (rgba.length < width * height * 4) {
    throw new Error(
      `RGBA buffer too small for ${width}×${height} (got ${rgba.length} bytes)`,
    )
  }
  const mask = createMaskBuffer(width, height, 0)
  for (let i = 0; i < mask.data.length; i += 1) {
    mask.data[i] = rgba[i * 4 + 3]!
  }
  return mask
}

/** Nearest-neighbor resize so API output can align to the original upload size. */
export function resizeMaskNearest(
  source: MaskPixelBuffer,
  targetWidth: number,
  targetHeight: number,
): MaskPixelBuffer {
  if (source.width === targetWidth && source.height === targetHeight) {
    return {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.data),
    }
  }
  if (targetWidth < 1 || targetHeight < 1) {
    throw new Error('Target mask dimensions must be positive')
  }
  const out = createMaskBuffer(targetWidth, targetHeight, 0)
  const sx = source.width / targetWidth
  const sy = source.height / targetHeight
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(source.height - 1, Math.floor(y * sy))
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(source.width - 1, Math.floor(x * sx))
      out.data[y * targetWidth + x] =
        source.data[srcY * source.width + srcX]!
    }
  }
  return out
}

/**
 * Build a mask from decoded RGBA, aligning to the original upload size when
 * the provider returns a different resolution.
 */
export function maskFromTransparentRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): { mask: MaskPixelBuffer; resized: boolean } {
  const extracted = extractAlphaMaskFromRgba(rgba, width, height)
  if (width === targetWidth && height === targetHeight) {
    return { mask: extracted, resized: false }
  }
  return {
    mask: resizeMaskNearest(extracted, targetWidth, targetHeight),
    resized: true,
  }
}

/** Soft-alpha presence (partial coverage along edges). */
export function countSoftAlphaPixels(
  mask: MaskPixelBuffer,
  low = 1,
  high = 254,
): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v >= low && v <= high) n += 1
  }
  return n
}
