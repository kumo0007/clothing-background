/**
 * Precision polygon mask edits in native image pixel coordinates.
 *
 * Polarity: 255 = KEEP garment, 0 = REMOVE background.
 * Polygon rasterization is intentionally hard-edged (0/255) inside the
 * selected region so users can deterministically correct white-on-white and
 * open-handle failures. Pixels outside the polygon are left unchanged
 * (including soft alpha) for add/subtract ops.
 */
import type { BrushMode, MaskPixelBuffer } from '../../types/mask'

export type PolygonPoint = { x: number; y: number }

/** Explicit polygon apply modes shown in the editor. */
export type PolygonApplyMode =
  | 'add'
  | 'subtract'
  | 'replace'
  | 'keep-inside'
  | 'remove-inside'

export function pointInPolygon(
  x: number,
  y: number,
  points: PolygonPoint[],
): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i]!.x
    const yi = points[i]!.y
    const xj = points[j]!.x
    const yj = points[j]!.y
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

/** Clamp a point into image bounds [0, width) × [0, height). */
export function clampPolygonPoint(
  point: PolygonPoint,
  width: number,
  height: number,
): PolygonPoint {
  return {
    x: Math.min(Math.max(0, point.x), Math.max(0, width - 1e-6)),
    y: Math.min(Math.max(0, point.y), Math.max(0, height - 1e-6)),
  }
}

/** Reject incomplete or near-collinear / zero-area rings. */
export function isDegeneratePolygon(points: PolygonPoint[]): boolean {
  if (points.length < 3) return true
  let area2 = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    area2 += a.x * b.y - b.x * a.y
  }
  return Math.abs(area2) < 1e-3
}

/**
 * True when the pointer is close enough to the first vertex to close the ring.
 * `thresholdImagePx` is in source-image pixels (caller converts from screen).
 */
export function isNearFirstVertex(
  points: PolygonPoint[],
  candidate: PolygonPoint,
  thresholdImagePx: number,
): boolean {
  if (points.length < 3) return false
  const first = points[0]!
  return (
    Math.hypot(candidate.x - first.x, candidate.y - first.y) <= thresholdImagePx
  )
}

function resolveFillValue(mode: PolygonApplyMode | BrushMode): number {
  if (mode === 'keep' || mode === 'add' || mode === 'keep-inside') return 255
  if (mode === 'remove' || mode === 'subtract' || mode === 'remove-inside') {
    return 0
  }
  // replace handled separately
  return 255
}

/**
 * Rasterize a closed polygon onto the mask at native resolution.
 * Uses pixel-center sampling (x+0.5, y+0.5) for stable edge inclusion.
 */
export function fillPolygonOnMask(
  mask: MaskPixelBuffer,
  points: PolygonPoint[],
  mode: BrushMode | PolygonApplyMode,
): number {
  if (points.length < 3 || isDegeneratePolygon(points)) {
    return 0
  }

  const { width, height, data } = mask
  const clamped = points.map((p) => clampPolygonPoint(p, width, height))

  if (mode === 'replace') {
    data.fill(0)
  }

  const value = mode === 'replace' ? 255 : resolveFillValue(mode)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of clamped) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(width - 1, Math.ceil(maxX))
  const y1 = Math.min(height - 1, Math.ceil(maxY))

  let painted = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!pointInPolygon(x + 0.5, y + 0.5, clamped)) continue
      const i = y * width + x
      if (data[i] !== value) {
        data[i] = value
        painted += 1
      } else {
        data[i] = value
      }
    }
  }
  return painted
}

/**
 * Apply several closed rings in order (add / subtract / replace).
 * Subtractive rings create interior holes (handbag handles).
 */
export function applyPolygonRingsToMask(
  mask: MaskPixelBuffer,
  rings: PolygonPoint[][],
  modes: Array<BrushMode | PolygonApplyMode>,
): number {
  let total = 0
  for (let i = 0; i < rings.length; i += 1) {
    const ring = rings[i]!
    const mode = modes[i] ?? 'add'
    total += fillPolygonOnMask(mask, ring, mode)
  }
  return total
}

/** Canvas Path2D fill at native resolution — used for cross-checks / optional path. */
export function fillPolygonOnMaskViaCanvas(
  mask: MaskPixelBuffer,
  points: PolygonPoint[],
  mode: BrushMode | PolygonApplyMode,
): number {
  if (points.length < 3 || isDegeneratePolygon(points) || typeof document === 'undefined') {
    return fillPolygonOnMask(mask, points, mode)
  }
  const { width, height } = mask
  const clamped = points.map((p) => clampPolygonPoint(p, width, height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fillPolygonOnMask(mask, points, mode)

  ctx.clearRect(0, 0, width, height)
  ctx.beginPath()
  ctx.moveTo(clamped[0]!.x, clamped[0]!.y)
  for (let i = 1; i < clamped.length; i += 1) {
    ctx.lineTo(clamped[i]!.x, clamped[i]!.y)
  }
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  const { data: rgba } = ctx.getImageData(0, 0, width, height)
  if (mode === 'replace') {
    mask.data.fill(0)
  }
  const value = mode === 'replace' ? 255 : resolveFillValue(mode)
  let painted = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (rgba[i * 4]! > 127) {
      mask.data[i] = value
      painted += 1
    }
  }
  return painted
}
