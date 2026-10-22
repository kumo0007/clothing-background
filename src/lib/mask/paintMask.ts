import type { BrushMode } from '../../types/mask'
import type { MaskPixelBuffer } from '../../types/mask'

function brushValue(mode: BrushMode): number {
  return mode === 'keep' ? 255 : 0
}

/**
 * Paint a filled circle onto the mask in image coordinates.
 * Uses a hard binary brush (255 or 0 only) to avoid gray edge halos
 * when compositing light garments on light backgrounds.
 */
export function paintMaskCircle(
  mask: MaskPixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  mode: BrushMode,
): void {
  const value = brushValue(mode)
  const { width, height, data } = mask
  const r = Math.max(0.5, radius)
  const r2 = r * r
  const rCeil = Math.ceil(r)
  const minX = Math.max(0, Math.floor(cx - rCeil))
  const maxX = Math.min(width - 1, Math.ceil(cx + rCeil))
  const minY = Math.max(0, Math.floor(cy - rCeil))
  const maxY = Math.min(height - 1, Math.ceil(cy + rCeil))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) {
        data[y * width + x] = value
      }
    }
  }
}

/** Paint a thick line between two image-space points by stamping circles. */
export function paintMaskStroke(
  mask: MaskPixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  mode: BrushMode,
): void {
  const distance = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(1, radius * 0.4)
  const count = Math.max(1, Math.ceil(distance / step))
  for (let i = 0; i <= count; i += 1) {
    const t = i / count
    paintMaskCircle(mask, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, mode)
  }
}
