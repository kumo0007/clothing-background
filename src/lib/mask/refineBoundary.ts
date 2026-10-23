/**
 * Conservative silhouette-boundary refinement.
 *
 * Only revisits the uncertain ring around KEEP/REMOVE transitions. Confident
 * garment interiors stay fixed. Does not restore footer pixels (caller should
 * re-run stripForeignBorderBands after this). Never mutates source RGB.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import {
  averageCornerColor,
  localLumaVariance,
} from './selectSimilar'

type Rgb = { r: number; g: number; b: number }

function readRgb(imageData: ImageData, x: number, y: number): Rgb {
  const o = (y * imageData.width + x) * 4
  return {
    r: imageData.data[o]!,
    g: imageData.data[o + 1]!,
    b: imageData.data[o + 2]!,
  }
}

function luma(rgb: Rgb): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
}

function chroma(rgb: Rgb): number {
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
}

function dist(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function isWarm(rgb: Rgb, L: number): boolean {
  return (
    L >= 70 &&
    L <= 210 &&
    rgb.r >= rgb.g &&
    rgb.g >= rgb.b - 8 &&
    rgb.r - rgb.b >= 18 &&
    chroma(rgb) >= 16
  )
}

function isNearNeutral(rgb: Rgb, maxC = 18): boolean {
  return chroma(rgb) <= maxC
}

/** Sobel-ish gradient magnitude on luma (3×3). */
function localGradient(
  imageData: ImageData,
  x: number,
  y: number,
): number {
  const w = imageData.width
  const h = imageData.height
  const at = (xx: number, yy: number) => {
    const cx = Math.min(w - 1, Math.max(0, xx))
    const cy = Math.min(h - 1, Math.max(0, yy))
    return luma(readRgb(imageData, cx, cy))
  }
  const gx =
    -at(x - 1, y - 1) +
    at(x + 1, y - 1) -
    2 * at(x - 1, y) +
    2 * at(x + 1, y) -
    at(x - 1, y + 1) +
    at(x + 1, y + 1)
  const gy =
    -at(x - 1, y - 1) -
    2 * at(x, y - 1) -
    at(x + 1, y - 1) +
    at(x - 1, y + 1) +
    2 * at(x, y + 1) +
    at(x + 1, y + 1)
  return Math.sqrt(gx * gx + gy * gy)
}

/**
 * Peel studio / soft-shadow KEEP along the silhouette ring without eating
 * dark, warm, chromatic, or textured bright garment material.
 * Returns number of pixels cleared or softened.
 */
export function refineSilhouetteBoundary(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const { width, height, data } = mask
  const corner = averageCornerColor(imageData)
  const studioLuma = luma(corner)
  const fringeTol = Math.max(26, Math.floor(tolerance * 0.8))
  let changed = 0

  // Boundary band: any non-zero mask pixel that neighbors a lower-opacity /
  // REMOVE pixel (or vice versa for soft leftovers).
  const onBoundary = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const v = data[i]!
      if (v === 0) continue
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]
      for (const n of neighbors) {
        if (n < 0) continue
        if (data[n]! < Math.min(v, 200)) {
          onBoundary[i] = 1
          break
        }
      }
      // Soft leftovers that do not touch REMOVE still count if near studio
      // and far from dark garment — caught in a second shallow expansion.
    }
  }

  // Expand boundary band 2px into KEEP so thick AA / soft-shadow rings reach.
  let band = new Uint8Array(onBoundary)
  for (let expand = 0; expand < 2; expand += 1) {
    const grown = new Uint8Array(band)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        if (band[i] || data[i]! === 0) continue
        if (
          band[i - 1] ||
          band[i + 1] ||
          band[i - width] ||
          band[i + width]
        ) {
          grown[i] = 1
        }
      }
    }
    band = grown
  }

  // Multi-pass peel: clearing outer AA exposes inner soft-shadow for the next.
  for (let pass = 0; pass < 6; pass += 1) {
  const next = new Uint8ClampedArray(data)
  let passChanged = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      // Recompute boundary each pass from current data
      const v = data[i]!
      if (v === 0) continue
      const nearRemove =
        data[i - 1]! === 0 ||
        data[i + 1]! === 0 ||
        data[i - width]! === 0 ||
        data[i + width]! === 0 ||
        band[i] === 1
      if (!nearRemove) continue

      const rgb = readRgb(imageData, x, y)
      const L = luma(rgb)
      const c = chroma(rgb)
      const dStudio = dist(rgb, corner)
      // Own-pixel flatness: 3×3 variance is inflated by dark garment neighbors
      // next to AA — use a tighter read that still detects leather texture.
      const variance = localLumaVariance(imageData, x, y, 1)
      const grad = localGradient(imageData, x, y)

      // Neighbor garment evidence (needed before protect/peel decisions)
      let darkKeep = 0
      let warmKeep = 0
      let chromaticKeep = 0
      let brightInterior = 0
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        const ni = ny * width + nx
        if (data[ni]! < 128) continue
        const nr = readRgb(imageData, nx, ny)
        const nL = luma(nr)
        const nC = chroma(nr)
        if (nL < 100) darkKeep += 1
        if (isWarm(nr, nL)) warmKeep += 1
        if (nC >= 18 && nL <= studioLuma - 15) chromaticKeep += 1
        if (nL >= 200 && isNearNeutral(nr, 22)) {
          const nTouchesRemove =
            (nx > 0 && data[ni - 1]! === 0) ||
            (nx + 1 < width && data[ni + 1]! === 0) ||
            (ny > 0 && data[ni - width]! === 0) ||
            (ny + 1 < height && data[ni + width]! === 0)
          if (!nTouchesRemove) brightInterior += 1
        }
      }
      const garmentKeep = darkKeep + warmKeep + chromaticKeep
      const edgeAaRing = garmentKeep >= 1 && brightInterior === 0

      // --- Confident garment: leave alone ---
      if (L < 85 && c < 36) {
        if (data[i]! < 255) {
          next[i] = 255
          changed += 1
        }
        continue
      }
      if (isWarm(rgb, L)) {
        if (data[i]! < 200) {
          next[i] = 255
          changed += 1
        }
        continue
      }
      if (c >= 22 && L <= studioLuma - 12 && dStudio >= 18) {
        if (data[i]! < 200) {
          next[i] = 255
          changed += 1
        }
        continue
      }
      // Textured bright leather / tee — not silhouette AA. High 3×3 variance
      // next to dark fabric must not promote edge AA into protected KEEP.
      const touchesRemove =
        data[i - 1]! === 0 ||
        data[i + 1]! === 0 ||
        data[i - width]! === 0 ||
        data[i + width]! === 0
      if (
        isNearNeutral(rgb, 22) &&
        L >= studioLuma + 2 &&
        variance > 10 &&
        !edgeAaRing &&
        !(touchesRemove && L >= 210 && brightInterior === 0)
      ) {
        if (data[i]! < 200) {
          next[i] = 255
          changed += 1
        }
        continue
      }

      // --- Studio / AA / soft-shadow peel ---
      // AA rings next to dark fabric often show high 3×3 variance; do not
      // require variance ≤ 10 for brightAaOnGarment when edgeAaRing is set.
      const flatStudio =
        isNearNeutral(rgb, 20) &&
        (variance <= 14 || edgeAaRing) &&
        dStudio <= fringeTol + 8 &&
        L >= studioLuma - 10 &&
        L <= studioLuma + 18

      const brightAaOnGarment =
        isNearNeutral(rgb, 22) &&
        L >= 185 &&
        edgeAaRing &&
        dStudio <= fringeTol + 12

      // Dark silhouette + bright studio fringe: peel even when 3×3 variance is
      // inflated by the dark wall (common sweater/handbag AA). Do not peel when
      // a flat bright interior neighbor exists (white leather / tee body).
      // Require touching REMOVE so sole-adjacent interior leather is not erased.
      const darkSilhouetteBrightFringe =
        darkKeep >= 1 &&
        brightInterior === 0 &&
        touchesRemove &&
        isNearNeutral(rgb, 24) &&
        L >= 175 &&
        !isWarm(rgb, L) &&
        dStudio <= fringeTol + 28

      // Near-white AA without an interior bright body (corner AA rings often
      // lack a 4-connected dark neighbor — only touch other AA + REMOVE).
      const isolatedBrightFringe =
        isNearNeutral(rgb, 22) &&
        L >= 215 &&
        brightInterior === 0 &&
        dStudio <= fringeTol + 16 &&
        darkKeep === 0

      const softShadowOnGarment =
        isNearNeutral(rgb, 16) &&
        L >= 70 &&
        L <= 165 &&
        L <= studioLuma - 18 &&
        (variance <= 16 || edgeAaRing) &&
        (garmentKeep >= 1 || dStudio <= fringeTol)

      // Mid-gray studio AA / bounce light hugging a dark silhouette — common
      // on sweater/cap/handbag exports where card match alone is weak.
      const midGrayOnDark =
        isNearNeutral(rgb, 18) &&
        L >= 100 &&
        L <= 205 &&
        darkKeep >= 1 &&
        brightInterior === 0 &&
        dStudio <= fringeTol + 22 &&
        (variance <= 22 || edgeAaRing)

      const weakEdgeStudio =
        flatStudio &&
        grad < 45 &&
        garmentKeep === 0 &&
        dStudio <= fringeTol

      if (
        brightAaOnGarment ||
        darkSilhouetteBrightFringe ||
        isolatedBrightFringe ||
        softShadowOnGarment ||
        midGrayOnDark ||
        weakEdgeStudio ||
        flatStudio
      ) {
        // Protect thin straps: high gradient + dark neighbors on two sides
        if (grad >= 70 && darkKeep >= 2 && L < 180) {
          continue
        }
        // Protect interior-backed bright leather (not edge AA)
        if (L >= studioLuma + 4 && brightInterior >= 1 && !brightAaOnGarment) {
          continue
        }
        next[i] = 0
        passChanged += 1
        changed += 1
        continue
      }

      // Ambiguous ring: soften only — never raise REMOVE.
      if (
        data[i]! >= 200 &&
        isNearNeutral(rgb, 24) &&
        dStudio <= fringeTol + 10 &&
        garmentKeep >= 1 &&
        L >= 160 &&
        variance <= 18
      ) {
        const soft = Math.max(
          0,
          Math.min(200, Math.round(dStudio * 6 + grad * 0.4)),
        )
        if (soft < data[i]!) {
          next[i] = soft
          passChanged += 1
          changed += 1
        }
      }
    }
  }

  data.set(next)
  if (passChanged === 0) break
  } // end multi-pass

  // Second shallow pass: clear residual soft (1–200) studio that still touches
  // REMOVE — these composite as visible gray halos.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const v = data[i]!
      if (v === 0 || v >= 230) continue
      const touchesRemove =
        data[i - 1]! === 0 ||
        data[i + 1]! === 0 ||
        data[i - width]! === 0 ||
        data[i + width]! === 0
      if (!touchesRemove) continue
      const rgb = readRgb(imageData, x, y)
      const L = luma(rgb)
      if (L < 90 || isWarm(rgb, L)) continue
      if (chroma(rgb) >= 24 && L <= studioLuma - 15) continue
      const dStudio = dist(rgb, corner)
      const variance = localLumaVariance(imageData, x, y, 1)
      if (
        isNearNeutral(rgb, 22) &&
        variance <= 14 &&
        (dStudio <= fringeTol + 6 || L >= studioLuma - 10)
      ) {
        data[i] = 0
        changed += 1
      }
    }
  }

  return changed
}
