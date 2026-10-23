/**
 * Documented OpenCV-free seed segmentation fallback.
 *
 * Uses border-sampled Lab background estimation, connectivity, and local
 * texture/chroma evidence — not a silent global RGB threshold. Selected when
 * GrabCut is unavailable or WASM cannot initialize (Node under Vite, etc.).
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer } from '../createMask'
import { applyPaleCompetition } from '../paleCompetition'
import { imageDataToLab8, labDist, type Lab } from './labColor'

export type SeedSegmentResult = {
  mask: MaskPixelBuffer
  methodUsed: 'opencv-seed-fallback'
  elapsedMs: number
  workingWidth: number
  workingHeight: number
}

function estimateBackgroundLab(
  labData: Uint8Array,
  width: number,
  height: number,
  step = 2,
): { mean: Lab; mad: number } {
  const samples: Lab[] = []
  const band = Math.max(1, Math.min(6, Math.floor(Math.min(width, height) * 0.02)))
  const push = (x: number, y: number) => {
    const o = (y * width + x) * 3
    samples.push({ L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! })
  }
  for (let y = 0; y < band; y += 1) {
    for (let x = 0; x < width; x += step) push(x, y)
  }
  for (let y = height - band; y < height; y += 1) {
    for (let x = 0; x < width; x += step) push(x, y)
  }
  for (let y = band; y < height - band; y += step) {
    for (let x = 0; x < band; x += 1) push(x, y)
    for (let x = width - band; x < width; x += 1) push(x, y)
  }
  if (samples.length === 0) {
    return { mean: { L: 200, a: 128, b: 128 }, mad: 8 }
  }
  samples.sort((u, v) => u.L - v.L)
  const lo = Math.floor(samples.length * 0.1)
  const hi = Math.max(lo + 1, Math.ceil(samples.length * 0.9))
  const trimmed = samples.slice(lo, hi)
  let sL = 0
  let sa = 0
  let sb = 0
  for (const s of trimmed) {
    sL += s.L
    sa += s.a
    sb += s.b
  }
  const n = trimmed.length
  const mean = { L: sL / n, a: sa / n, b: sb / n }
  const dists = trimmed.map((s) => labDist(s, mean)).sort((a, b) => a - b)
  const mad = dists[Math.floor(dists.length / 2)] ?? 8
  return { mean, mad: Math.max(4, mad) }
}

function softenBoundary(
  mask: MaskPixelBuffer,
  labData: Uint8Array,
  bgMean: Lab,
): void {
  const { width, height, data } = mask
  const src = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const v = src[i]!
      let minN = 255
      let maxN = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const n = src[(y + dy) * width + (x + dx)]!
          if (n < minN) minN = n
          if (n > maxN) maxN = n
        }
      }
      if (maxN - minN < 40) continue
      const o = i * 3
      const d = labDist(
        { L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! },
        bgMean,
      )
      const soft = Math.max(0, Math.min(255, Math.floor(d * 10)))
      if (v >= 200) {
        data[i] = Math.max(soft, Math.min(255, Math.floor((v + soft) / 2)))
      } else if (v <= 20 && soft > 40 && maxN >= 200) {
        data[i] = Math.min(180, soft)
      }
    }
  }
}

/**
 * Expand KEEP from dark garment seeds into adjacent pale REMOVE pixels that
 * look like white leather / light fabric (near-card Lab, low chroma). Stops at
 * the image border and at definite studio-like lows. Does not loosen global
 * Lab thresholds — only grows by 4-connected evidence from dark structure.
 */
function reclaimPaleFromDarkSeeds(
  mask: MaskPixelBuffer,
  labData: Uint8Array,
  bgMean: Lab,
  width: number,
  height: number,
  passes = 14,
): void {
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.02))
  for (let pass = 0; pass < passes; pass += 1) {
    const add: number[] = []
    for (let y = borderBand; y < height - borderBand; y += 1) {
      for (let x = borderBand; x < width - borderBand; x += 1) {
        const i = y * width + x
        // Grow into REMOVE and weak soft alpha; promote soft pale to solid KEEP.
        if (mask.data[i]! >= 200) continue
        const o = i * 3
        const L = labData[o]!
        const da = labData[o + 1]! - 128
        const db = labData[o + 2]! - 128
        const chroma = Math.sqrt(da * da + db * db)
        if (chroma > 24) continue
        if (L < bgMean.L - 10) continue
        // Prefer at/above card; allow slight below for soft suede/grey panels.
        if (L < bgMean.L - 4 && L < 195) continue

        let darkKeep = 0
        let paleKeep = 0
        for (const n of [i - 1, i + 1, i - width, i + width]) {
          if (mask.data[n]! < 128) continue
          const nL = labData[n * 3]!
          if (nL < 100) darkKeep += 1
          else if (nL >= bgMean.L - 6) paleKeep += 1
        }
        if (darkKeep === 0 && paleKeep === 0) continue
        // From sole into lifted white leather — not flat card AA (halo).
        const fromSole = darkKeep >= 1 && L >= bgMean.L + 1.5
        // From already-kept pale panel — require clear lift so flat card
        // next to dark brims (caps) does not flood into the studio.
        const fromPanel =
          paleKeep >= 2 && L >= bgMean.L + 2.5
        if (fromSole || fromPanel) {
          add.push(i)
        }
      }
    }
    if (add.length === 0) break
    for (const i of add) mask.data[i] = 255
  }
}

/**
 * Seed-based garment mask at full resolution (no GrabCut / no WASM).
 * Never mutates source ImageData RGB.
 */
export function segmentGarmentBySeeds(imageData: ImageData): SeedSegmentResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const width = imageData.width
  const height = imageData.height
  const labData = imageDataToLab8(imageData)
  const bg = estimateBackgroundLab(labData, width, height)
  const pixels = width * height
  const dist = new Float32Array(pixels)
  const lumaVar = new Float32Array(pixels)
  const bgThresh = Math.min(22, Math.max(10, bg.mad * 2.2))
  const fgThresh = Math.max(bgThresh + 8, bg.mad * 4.5)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const o = i * 3
      dist[i] = labDist(
        { L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! },
        bg.mean,
      )
      let sum = 0
      let sumSq = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const L = labData[(yy * width + xx) * 3]!
          sum += L
          sumSq += L * L
          count += 1
        }
      }
      const mean = sum / count
      lumaVar[i] = sumSq / count - mean * mean
    }
  }

  const definiteBg = new Uint8Array(pixels)
  const queue: number[] = []
  const trySeed = (x: number, y: number) => {
    const i = y * width + x
    if (dist[i]! <= bgThresh * 1.15) {
      definiteBg[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x += 1) {
    trySeed(x, 0)
    trySeed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    trySeed(0, y)
    trySeed(width - 1, y)
  }
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    const x = i % width
    const y = (i / width) | 0
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]
    for (const n of neighbors) {
      if (n < 0 || definiteBg[n]) continue
      if (dist[n]! > bgThresh * 1.25) continue
      const Ln = labData[n * 3]!
      // Do not flood into at/above-card material (white leather / pale fabric).
      // Prior +5 gate let flat leather at card+2–4 become definite BG.
      if (Ln > bg.mean.L + 0.75) continue
      if (lumaVar[n]! > 12 && Ln >= bg.mean.L - 3) continue
      definiteBg[n] = 1
      queue.push(n)
    }
  }

  const mask = createMaskBuffer(width, height, 0)
  for (let i = 0; i < pixels; i += 1) {
    const d = dist[i]!
    const o = i * 3
    const da = labData[o + 1]! - 128
    const db = labData[o + 2]! - 128
    const chroma = Math.sqrt(da * da + db * db)
    const L = labData[o]!
    const textured = lumaVar[i]! > 12
    const chromatic = chroma > 14
    const dark = L < 90
    const warm =
      labData[o + 2]! > 140 && labData[o + 1]! > 120 && chroma > 10
    // Brighter-than-studio neutrals are garment when clearly lifted or textured.
    // Mild +1–2 L JPEG card lift must stay BG (caps / flat studio), not KEEP.
    const brightLeather =
      L > bg.mean.L + 3 &&
      chroma < 20 &&
      !definiteBg[i] &&
      (textured || L > bg.mean.L + 5)

    if (definiteBg[i] && !brightLeather) {
      mask.data[i] = 0
      continue
    }

    // JPEG flat-card noise often yields lumaVar just above 12 — that must NOT
    // become definite KEEP or we grow angular studio slabs (blazer/jeans).
    const stronglyTextured = lumaVar[i]! > 28
    if (
      d >= fgThresh ||
      dark ||
      (chromatic && d > bgThresh * 0.7) ||
      warm ||
      brightLeather ||
      (stronglyTextured && d > bgThresh * 0.75)
    ) {
      mask.data[i] = 255
    } else if (d <= bgThresh * 1.05 && definiteBg[i]) {
      mask.data[i] = 0
    } else if (d <= bgThresh * 0.85) {
      mask.data[i] = 0
    } else {
      // Uncertain ring — soft alpha from Lab distance; bias toward KEEP only
      // when clearly above card so flat JPEG lift stays strippable.
      const soft = Math.max(40, Math.min(220, Math.floor(d * 10)))
      mask.data[i] =
        L >= bg.mean.L + 2.5 && chroma < 18 ? Math.max(soft, 140) : soft
    }
  }

  // Grow pale KEEP from dark soles / mesh into adjacent REMOVE that looks like
  // flat white leather — connectivity, not a global Lab loosen.
  reclaimPaleFromDarkSeeds(mask, labData, bg.mean, width, height)
  // Competing structure-vs-exterior geodesics recover interior white panels
  // (sneakers) without treating every near-card match as background.
  applyPaleCompetition(mask, imageData)

  softenBoundary(mask, labData, bg.mean)
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    mask,
    methodUsed: 'opencv-seed-fallback',
    elapsedMs: Math.round(t1 - t0),
    workingWidth: width,
    workingHeight: height,
  }
}
