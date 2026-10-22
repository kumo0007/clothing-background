import type { BrushMode } from '../../types/mask'
import type { MaskPixelBuffer } from '../../types/mask'

export type PolygonPoint = { x: number; y: number }

function pointInPolygon(x: number, y: number, points: PolygonPoint[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x
    const yi = points[i].y
    const xj = points[j].x
    const yj = points[j].y
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

/** Fill a closed polygon on the mask with KEEP (255) or REMOVE (0). */
export function fillPolygonOnMask(
  mask: MaskPixelBuffer,
  points: PolygonPoint[],
  mode: BrushMode,
): void {
  if (points.length < 3) {
    return
  }

  const value = mode === 'keep' ? 255 : 0
  const { width, height, data } = mask
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(width - 1, Math.ceil(maxX))
  const y1 = Math.min(height - 1, Math.ceil(maxY))

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) {
        data[y * width + x] = value
      }
    }
  }
}
