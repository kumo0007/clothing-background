/**
 * Conservative silhouette alpha refinement (trimap-style, no RGB rewrite).
 *
 * Fixes pale fringes caused by:
 * - Soft alpha on studio-colored edge pixels (composites original card RGB)
 * - softenBoundary raising REMOVE into partial KEEP
 * - Uncertain seed bands that look like background but kept mid-alpha
 *
 * Only uncertain boundary pixels are modified. Interior KEEP (≥ band depth)
 * and deep REMOVE stay fixed. Source ImageData is never mutated.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { imageDataToLab8, labDist, type Lab } from './opencv/labColor'

const KEEP_HARD = 200
const REMOVE_HARD = 20

function readLab(lab: Uint8Array, i: number): Lab {
  const o = i * 3
  return { L: lab[o]!, a: lab[o + 1]!, b: lab[o + 2]! }
}

function chromaOf(lab: Lab): number {
  const da = lab.a - 128
  const db = lab.b - 128
  return Math.sqrt(da * da + db * db)
}

/**
 * Refine mask alphas along the silhouette using local FG/BG Lab evidence.
 * Returns number of pixels changed.
 */
export function refineBoundaryAlpha(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  options: { bandRadius?: number } = {},
): number {
  const bandRadius = Math.max(1, options.bandRadius ?? 2)
  const { width, height, data } = mask
  const lab = imageDataToLab8(imageData)
  const pixels = width * height
  const src = new Uint8ClampedArray(data)

  // Distance to nearest REMOVE (for interior protection) and nearest KEEP.
  const distToRemove = new Int16Array(pixels)
  const distToKeep = new Int16Array(pixels)
  distToRemove.fill(32767)
  distToKeep.fill(32767)
  const qR: number[] = []
  const qK: number[] = []
  for (let i = 0; i < pixels; i += 1) {
    if (src[i]! <= REMOVE_HARD) {
      distToRemove[i] = 0
      qR.push(i)
    }
    if (src[i]! >= KEEP_HARD) {
      distToKeep[i] = 0
      qK.push(i)
    }
  }
  const floodDist = (queue: number[], dist: Int16Array, maxD: number) => {
    let head = 0
    while (head < queue.length) {
      const i = queue[head++]!
      const d = dist[i]!
      if (d >= maxD) continue
      const x = i % width
      const y = (i / width) | 0
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]
      for (const n of neighbors) {
        if (n < 0 || dist[n]! <= d + 1) continue
        dist[n] = d + 1
        queue.push(n)
      }
    }
  }
  floodDist(qR, distToRemove, bandRadius + 2)
  floodDist(qK, distToKeep, bandRadius + 2)

  let changed = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const dRem = distToRemove[i]!
      const dKeep = distToKeep[i]!
      // Only refine the silhouette band (near both FG and BG).
      const onBoundary =
        dRem <= bandRadius + 1 && dKeep <= bandRadius + 1
      const softPixel = src[i]! > REMOVE_HARD && src[i]! < KEEP_HARD
      if (!onBoundary && !softPixel) continue
      // Protect deep interior KEEP.
      if (src[i]! >= KEEP_HARD && dRem > bandRadius + 1) continue

      // Local FG: sample KEEP neighbors inward; BG: REMOVE / near-bg samples.
      let fgL = 0
      let fgA = 0
      let fgB = 0
      let fgN = 0
      let bgL = 0
      let bgA = 0
      let bgB = 0
      let bgN = 0
      let maxFgChroma = 0
      let minFgL = 255

      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          const labN = readLab(lab, ni)
          if (src[ni]! >= KEEP_HARD && distToRemove[ni]! >= 1) {
            fgL += labN.L
            fgA += labN.a
            fgB += labN.b
            fgN += 1
            maxFgChroma = Math.max(maxFgChroma, chromaOf(labN))
            minFgL = Math.min(minFgL, labN.L)
          }
          if (src[ni]! <= REMOVE_HARD || distToKeep[ni]! > bandRadius) {
            // Prefer true REMOVE samples for BG model.
            if (src[ni]! <= REMOVE_HARD) {
              bgL += labN.L
              bgA += labN.a
              bgB += labN.b
              bgN += 1
            }
          }
        }
      }

      // Fallback BG from image border mean of REMOVE-ish corners if empty.
      if (bgN < 3) {
        for (const [bx, by] of [
          [0, 0],
          [width - 1, 0],
          [0, height - 1],
          [width - 1, height - 1],
        ] as const) {
          const bi = by * width + bx
          const labB = readLab(lab, bi)
          bgL += labB.L
          bgA += labB.a
          bgB += labB.b
          bgN += 1
        }
      }
      if (fgN < 1 || bgN < 1) continue

      const fg: Lab = { L: fgL / fgN, a: fgA / fgN, b: fgB / fgN }
      const bg: Lab = { L: bgL / bgN, a: bgA / bgN, b: bgB / bgN }
      const pix = readLab(lab, i)
      const dFg = labDist(pix, fg)
      const dBg = labDist(pix, bg)
      const pixChroma = chromaOf(pix)

      // Evidence: chromatic/warm/dark pixels toward FG stay opaque.
      const looksLikeGarment =
        pixChroma >= 16 ||
        pix.L < 95 ||
        (pix.b > 138 && pix.a > 118 && pixChroma > 10) ||
        (maxFgChroma >= 16 && dFg + 4 < dBg) ||
        (minFgL < 100 && pix.L < minFgL + 25 && dFg <= dBg + 6)

      // Bright neutral nearer BG than FG → studio fringe / AA card.
      const looksLikeStudioFringe =
        pixChroma < 14 &&
        pix.L >= bg.L - 8 &&
        dBg + 2 <= dFg &&
        !(pix.L > bg.L + 8 && dFg + 6 < dBg) // brighter leather exception

      let next = src[i]!
      if (looksLikeStudioFringe && !looksLikeGarment) {
        next = 0
      } else if (looksLikeGarment && dFg + 3 < dBg) {
        next = 255
      } else if (onBoundary || softPixel) {
        // Soft alpha only in the uncertain band from relative Lab affinity.
        const denom = dFg + dBg
        if (denom < 1e-3) {
          next = src[i]! >= 128 ? 255 : 0
        } else {
          // alpha high when closer to FG
          const a = 1 - dFg / denom
          // Bias against pale studio: if near BG luma and low chroma, pull down.
          let alpha = a
          if (pixChroma < 12 && Math.abs(pix.L - bg.L) < 10) {
            alpha *= 0.35
          }
          if (looksLikeGarment) {
            alpha = Math.max(alpha, 0.75)
          }
          next = Math.max(0, Math.min(255, Math.round(alpha * 255)))
          // Avoid tiny mid-grays that read as dirty fringe — snap.
          if (next < 40) next = 0
          if (next > 220) next = 255
        }
      }

      if (next !== data[i]) {
        data[i] = next
        changed += 1
      }
    }
  }

  return changed
}

/**
 * Harden soft seed alphas that are studio-like before morphology/choke.
 * Leaves chromatic/dark/warm soft pixels as KEEP candidates (255).
 */
export function hardenStudioSoftAlpha(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): number {
  const lab = imageDataToLab8(imageData)
  const { width, height, data } = mask
  // Estimate BG from corners
  const corners = [
    readLab(lab, 0),
    readLab(lab, width - 1),
    readLab(lab, (height - 1) * width),
    readLab(lab, (height - 1) * width + width - 1),
  ]
  const bg: Lab = {
    L: (corners[0]!.L + corners[1]!.L + corners[2]!.L + corners[3]!.L) / 4,
    a: (corners[0]!.a + corners[1]!.a + corners[2]!.a + corners[3]!.a) / 4,
    b: (corners[0]!.b + corners[1]!.b + corners[2]!.b + corners[3]!.b) / 4,
  }
  let changed = 0
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i]!
    if (v <= REMOVE_HARD || v >= KEEP_HARD) continue
    const pix = readLab(lab, i)
    const c = chromaOf(pix)
    const dBg = labDist(pix, bg)
    if (c < 14 && dBg < 18 && pix.L >= bg.L - 12) {
      data[i] = 0
      changed += 1
    } else if (c >= 16 || pix.L < 100 || dBg >= 22) {
      data[i] = 255
      changed += 1
    }
  }
  return changed
}
