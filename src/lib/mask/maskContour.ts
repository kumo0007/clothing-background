/**
 * Trace connected foreground mask regions into polygon rings (source pixels).
 *
 * Contours follow the actual KEEP silhouette — not bounding boxes. Interior
 * holes (handbag handles) become separate rings. Simplification is conservative
 * so thin straps / narrow sleeves survive.
 *
 * A contour of an incorrect mask remains incorrect; this is for edit/assist,
 * not a substitute for segmentation.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import {
  fillPolygonOnMask,
  type PolygonPoint,
  applyPolygonRingsToMask,
} from './polygonMask'
import { createMaskBuffer } from './createMask'

export type ContourRing = {
  /** Exterior or hole ring in source-image pixel coordinates. */
  points: PolygonPoint[]
  /** True when this ring is an interior hole (odd winding vs parent). */
  isHole: boolean
}

export type ExtractContoursOptions = {
  /** KEEP threshold (default 128). */
  threshold?: number
  /**
   * Douglas–Peucker tolerance in source pixels (default 1.25).
   * Lower keeps more vertices for thin features.
   */
  simplifyTolerance?: number
  /** Drop rings shorter than this after simplification (default 3). */
  minPoints?: number
}

function isFg(mask: MaskPixelBuffer, x: number, y: number, thr: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false
  return mask.data[y * mask.width + x]! >= thr
}

/**
 * Moore neighborhood contour trace for one component starting at a boundary
 * pixel. Returns closed ring in image coordinates (pixel centers).
 */
function traceBoundary(
  mask: MaskPixelBuffer,
  startX: number,
  startY: number,
  thr: number,
  visitedEdge: Uint8Array,
): PolygonPoint[] | null {
  const { width, height } = mask
  // 8-connected clockwise offsets from west-facing start convention.
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  const points: PolygonPoint[] = []
  let x = startX
  let y = startY
  let dir = 0
  const maxSteps = width * height * 4

  for (let step = 0; step < maxSteps; step += 1) {
    points.push({ x: x + 0.5, y: y + 0.5 })
    const edgeKey = (y * width + x) * 8 + dir
    if (visitedEdge[edgeKey]) {
      break
    }
    visitedEdge[edgeKey] = 1

    // Backtrack: start search from dir-2 (Moore).
    let found = false
    for (let k = 0; k < 8; k += 1) {
      const nd = (dir + 6 + k) % 8
      const nx = x + dx[nd]!
      const ny = y + dy[nd]!
      if (!isFg(mask, nx, ny, thr)) continue
      x = nx
      y = ny
      dir = nd
      found = true
      break
    }
    if (!found) break
    if (x === startX && y === startY && points.length > 2) {
      break
    }
  }

  if (points.length < 3) return null
  return points
}

function perpendicularDistance(
  p: PolygonPoint,
  a: PolygonPoint,
  b: PolygonPoint,
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y)
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/** Douglas–Peucker; preserves sharp corners when tolerance is low. */
export function simplifyPolygon(
  points: PolygonPoint[],
  tolerance: number,
): PolygonPoint[] {
  if (points.length <= 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!
    let maxD = 0
    let maxI = i0
    const a = points[i0]!
    const b = points[i1]!
    for (let i = i0 + 1; i < i1; i += 1) {
      const d = perpendicularDistance(points[i]!, a, b)
      if (d > maxD) {
        maxD = d
        maxI = i
      }
    }
    if (maxD > tolerance) {
      keep[maxI] = 1
      stack.push([i0, maxI], [maxI, i1])
    }
  }

  const out: PolygonPoint[] = []
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) out.push(points[i]!)
  }
  return out.length >= 3 ? out : points.slice(0, 3)
}

function ringArea(points: PolygonPoint[]): number {
  let a = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/**
 * Extract exterior + hole rings from a mask at native resolution.
 */
export function extractMaskContours(
  mask: MaskPixelBuffer,
  options: ExtractContoursOptions = {},
): ContourRing[] {
  const thr = options.threshold ?? 128
  const simplifyTol = options.simplifyTolerance ?? 1.25
  const minPoints = options.minPoints ?? 3
  const { width, height } = mask
  const visited = new Uint8Array(width * height)
  const visitedEdge = new Uint8Array(width * height * 8)
  const rings: ContourRing[] = []

  // Label FG components; for each, find an outer boundary seed (leftmost).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (visited[i] || mask.data[i]! < thr) continue

      // Flood-fill component.
      const component: number[] = []
      const q: number[] = [i]
      visited[i] = 1
      let minX = x
      let minY = y
      let seed = i
      let head = 0
      while (head < q.length) {
        const cur = q[head++]!
        component.push(cur)
        const cx = cur % width
        const cy = (cur / width) | 0
        if (cx < minX || (cx === minX && cy < minY)) {
          minX = cx
          minY = cy
          seed = cur
        }
        for (const n of [
          cx > 0 ? cur - 1 : -1,
          cx + 1 < width ? cur + 1 : -1,
          cy > 0 ? cur - width : -1,
          cy + 1 < height ? cur + width : -1,
        ]) {
          if (n < 0 || visited[n] || mask.data[n]! < thr) continue
          visited[n] = 1
          q.push(n)
        }
      }

      const sx = seed % width
      const sy = (seed / width) | 0
      const outer = traceBoundary(mask, sx, sy, thr, visitedEdge)
      if (!outer) continue
      const simplified = simplifyPolygon(outer, simplifyTol)
      if (simplified.length < minPoints) continue
      // Ensure exterior rings are oriented consistently (positive area CCW).
      const oriented =
        ringArea(simplified) < 0 ? simplified.slice().reverse() : simplified
      rings.push({
        points: oriented,
        isHole: false,
      })

      // Interior holes: BG components fully inside bbox that touch FG.
      // Scan component bbox for REMOVE pockets and trace their boundaries.
      let maxX = 0
      let maxY = 0
      minX = width
      minY = height
      for (const idx of component) {
        const px = idx % width
        const py = (idx / width) | 0
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }

      const holeVisited = new Uint8Array(width * height)
      for (let hy = minY; hy <= maxY; hy += 1) {
        for (let hx = minX; hx <= maxX; hx += 1) {
          const hi = hy * width + hx
          if (holeVisited[hi] || mask.data[hi]! >= thr) continue
          // Only consider BG that has an FG neighbor (interior notch / hole).
          let touchesFg = false
          for (const n of [hi - 1, hi + 1, hi - width, hi + width]) {
            if (n < 0 || n >= mask.data.length) continue
            if (mask.data[n]! >= thr) {
              touchesFg = true
              break
            }
          }
          if (!touchesFg) {
            holeVisited[hi] = 1
            continue
          }

          // Flood BG pocket; skip if it touches image border (exterior BG).
          const holeQ: number[] = [hi]
          holeVisited[hi] = 1
          const holePixels: number[] = []
          let touchesImageBorder = false
          let hHead = 0
          while (hHead < holeQ.length) {
            const cur = holeQ[hHead++]!
            holePixels.push(cur)
            const cx = cur % width
            const cy = (cur / width) | 0
            if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
              touchesImageBorder = true
            }
            for (const n of [
              cx > 0 ? cur - 1 : -1,
              cx + 1 < width ? cur + 1 : -1,
              cy > 0 ? cur - width : -1,
              cy + 1 < height ? cur + width : -1,
            ]) {
              if (n < 0 || holeVisited[n] || mask.data[n]! >= thr) continue
              // Stay inside component bbox expanded by 1.
              const nx = n % width
              const ny = (n / width) | 0
              if (nx < minX - 1 || ny < minY - 1 || nx > maxX + 1 || ny > maxY + 1) {
                continue
              }
              holeVisited[n] = 1
              holeQ.push(n)
            }
          }
          if (touchesImageBorder || holePixels.length < 4) continue

          // Seed = leftmost hole pixel.
          let holeSeed = holePixels[0]!
          for (const p of holePixels) {
            const px = p % width
            const py = (p / width) | 0
            const sx0 = holeSeed % width
            const sy0 = (holeSeed / width) | 0
            if (px < sx0 || (px === sx0 && py < sy0)) holeSeed = p
          }
          // Trace on inverted sense: treat hole as FG for boundary walk.
          const inv = createMaskBuffer(width, height, 0)
          for (const p of holePixels) inv.data[p] = 255
          const holeRing = traceBoundary(
            inv,
            holeSeed % width,
            (holeSeed / width) | 0,
            128,
            new Uint8Array(width * height * 8),
          )
          if (!holeRing) continue
          const simpHole = simplifyPolygon(holeRing, simplifyTol)
          if (simpHole.length < minPoints) continue
          rings.push({ points: simpHole, isHole: true })
        }
      }
    }
  }

  return rings
}

/**
 * Rasterize extracted contours back onto a mask (exteriors add, holes subtract).
 * Returns count of pixels that differ from the source mask (round-trip error).
 */
export function contoursToMask(
  width: number,
  height: number,
  rings: ContourRing[],
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  const exteriors = rings.filter((r) => !r.isHole).map((r) => r.points)
  const holes = rings.filter((r) => r.isHole).map((r) => r.points)
  applyPolygonRingsToMask(
    mask,
    [...exteriors, ...holes],
    [
      ...exteriors.map(() => 'add' as const),
      ...holes.map(() => 'subtract' as const),
    ],
  )
  return mask
}

/** Count pixels that differ after contour extract → rasterize round trip. */
export function contourRoundTripChangedPixels(
  mask: MaskPixelBuffer,
  options: ExtractContoursOptions = {},
): { changed: number; rings: ContourRing[]; rebuilt: MaskPixelBuffer } {
  const rings = extractMaskContours(mask, options)
  const rebuilt = contoursToMask(mask.width, mask.height, rings)
  let changed = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const a = mask.data[i]! >= 128 ? 1 : 0
    const b = rebuilt.data[i]! >= 128 ? 1 : 0
    if (a !== b) changed += 1
  }
  return { changed, rings, rebuilt }
}

/** Convenience: fill from a single exterior ring (replace). */
export function applyContourAsReplace(
  mask: MaskPixelBuffer,
  ring: PolygonPoint[],
): number {
  return fillPolygonOnMask(mask, ring, 'replace')
}
