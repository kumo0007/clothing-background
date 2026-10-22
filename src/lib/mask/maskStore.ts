import { createMaskBuffer, cloneMaskBuffer } from './createMask'
import type { MaskPixelBuffer } from '../../types/mask'

/**
 * In-memory mask buffers keyed by image id.
 * Kept outside React state to avoid cloning huge arrays on every paint frame.
 */
const masks = new Map<string, MaskPixelBuffer>()

export function getOrCreateMask(
  imageId: string,
  width: number,
  height: number,
): MaskPixelBuffer {
  const existing = masks.get(imageId)
  if (existing && existing.width === width && existing.height === height) {
    return existing
  }
  const created = createMaskBuffer(width, height, 0)
  masks.set(imageId, created)
  return created
}

export function getMask(imageId: string): MaskPixelBuffer | undefined {
  return masks.get(imageId)
}

export function setMask(imageId: string, mask: MaskPixelBuffer): void {
  masks.set(imageId, mask)
}

export function replaceMaskPixels(
  imageId: string,
  next: MaskPixelBuffer,
): MaskPixelBuffer {
  const copy = cloneMaskBuffer(next)
  masks.set(imageId, copy)
  return copy
}

export function deleteMask(imageId: string): void {
  masks.delete(imageId)
}

export function clearAllMasks(): void {
  masks.clear()
}
