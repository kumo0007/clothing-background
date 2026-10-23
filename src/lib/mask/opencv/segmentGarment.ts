/**
 * Hybrid garment segmentation using OpenCV.js.
 *
 * Verified APIs (@techstark/opencv-js@4.10.0-release.1):
 *   grabCut, GC_*, connectedComponentsWithStats, cvtColor,
 *   COLOR_RGBA2RGB, COLOR_RGB2Lab, morphologyEx, Canny, distanceTransform,
 *   matFromImageData, resize, GaussianBlur, erode, dilate.
 *
 * Not available: COLOR_RGBA2Lab (use RGBA→RGB→Lab), pyrMeanShiftFiltering.
 *
 * Method: border-sampled Lab background model → FG/BG/uncertain seeds →
 * GrabCut (GC_INIT_WITH_MASK) at a working resolution → upsample → soft edge.
 * If GrabCut throws or is missing, falls back to seed confidence only
 * (documented — not a silent global threshold substitute claiming equivalence).
 *
 * Produces a mask only; never mutates source RGB.
 */

import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer } from '../createMask'
import type { OpenCvMat, OpenCvRuntime } from './cvTypes'
import { hasGrabCut } from './cvTypes'
import { loadOpenCv } from './loadOpenCv'
import { segmentGarmentBySeeds } from './segmentSeeds'

function isNodeRuntime(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } } }
  return Boolean(g.process?.versions?.node)
}

export type SegmentGarmentOptions = {
  /** Max longer side for GrabCut working resolution (default 160). */
  maxWorkingSide?: number
  /** GrabCut iterations (default 2). */
  grabCutIters?: number
  /** Prefer seed-only path even when GrabCut exists (tests / comparison). */
  forceSeedFallback?: boolean
  /**
   * Opt into main-thread GrabCut. Default false — OpenCV.js GrabCut routinely
   * hangs the browser UI; the Lab-seed path is the supported interactive path.
   */
  allowGrabCut?: boolean
}

export type SegmentGarmentResult = {
  mask: MaskPixelBuffer
  methodUsed: 'opencv-grabcut' | 'opencv-seed-fallback'
  elapsedMs: number
  workingWidth: number
  workingHeight: number
}

type Lab = { L: number; a: number; b: number }

function labDist(p: Lab, q: Lab): number {
  const dL = p.L - q.L
  const da = p.a - q.a
  const db = p.b - q.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

function deleteMats(...mats: Array<OpenCvMat | null | undefined>): void {
  for (const m of mats) {
    if (m) {
      try {
        m.delete()
      } catch {
        // already freed
      }
    }
  }
}

/** Sample Lab background mean from border bands (not just four corners). */
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

  // Robust-ish: trim extremes on L, then mean.
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

/**
 * Build GrabCut seed labels:
 *  GC_BGD / GC_FGD = hard constraints
 *  GC_PR_BGD / GC_PR_FGD = soft
 *
 * White leather / pale fabric near studio card is marked PR_FGD when it is
 * interior (not border-connected as definite background), so GrabCut can keep it.
 */
function buildSeedMask(
  cv: OpenCvRuntime,
  labData: Uint8Array,
  width: number,
  height: number,
  bg: { mean: Lab; mad: number },
): { seeds: Uint8Array; definiteBg: Uint8Array } {
  const pixels = width * height
  const dist = new Float32Array(pixels)
  const lumaVar = new Float32Array(pixels)

  const bgThresh = Math.min(22, Math.max(10, bg.mad * 2.2))
  const fgThresh = Math.max(bgThresh + 8, bg.mad * 4.5)

  // Lab distance + tiny 3×3 luma variance (texture cue for leather vs card).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const o = i * 3
      const lab = { L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! }
      dist[i] = labDist(lab, bg.mean)

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

  // Definite background: flood from border through low-distance pixels.
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
      // Slightly looser while staying near the BG appearance.
      if (dist[n]! <= bgThresh * 1.35) {
        definiteBg[n] = 1
        queue.push(n)
      }
    }
  }

  const seeds = new Uint8Array(pixels)
  const chromaOf = (i: number) => {
    const o = i * 3
    // Lab a/b centered ~128 in 8-bit OpenCV Lab
    const da = labData[o + 1]! - 128
    const db = labData[o + 2]! - 128
    return Math.sqrt(da * da + db * db)
  }

  for (let i = 0; i < pixels; i += 1) {
    if (definiteBg[i]) {
      seeds[i] = cv.GC_BGD
      continue
    }

    const d = dist[i]!
    const chroma = chromaOf(i)
    const L = labData[i * 3]!
    const textured = lumaVar[i]! > 18
    const chromatic = chroma > 14
    const dark = L < 90
    const warm =
      labData[i * 3 + 2]! > 140 && labData[i * 3 + 1]! > 120 && chroma > 10

    // Hard foreground: clearly not studio, or dark/chromatic/warm garment.
    if (d >= fgThresh || dark || (chromatic && d > bgThresh) || warm) {
      seeds[i] = cv.GC_FGD
      continue
    }

    // Pale interior near card color — likely white leather / light fabric.
    // Do NOT hard-label as BGD; mark probable FG so GrabCut preserves it.
    if (d <= bgThresh * 1.5 && (textured || L > bg.mean.L + 4)) {
      seeds[i] = cv.GC_PR_FGD
      continue
    }

    if (d <= bgThresh * 1.1) {
      seeds[i] = cv.GC_PR_BGD
    } else if (d >= (bgThresh + fgThresh) * 0.5) {
      seeds[i] = cv.GC_PR_FGD
    } else {
      seeds[i] = cv.GC_PR_FGD
    }
  }

  // Ensure we have both FG and BG seeds; otherwise GrabCut can collapse.
  let hasFgd = false
  let hasBgd = false
  for (let i = 0; i < pixels; i += 1) {
    const s = seeds[i]!
    if (s === cv.GC_FGD || s === cv.GC_PR_FGD) hasFgd = true
    if (s === cv.GC_BGD || s === cv.GC_PR_BGD) hasBgd = true
    if (hasFgd && hasBgd) break
  }
  if (!hasBgd) {
    // Force a thin border as BGD.
    for (let x = 0; x < width; x += 1) {
      seeds[x] = cv.GC_BGD
      seeds[(height - 1) * width + x] = cv.GC_BGD
    }
  }
  if (!hasFgd) {
    const cx = (width / 2) | 0
    const cy = (height / 2) | 0
    const r = Math.max(2, Math.floor(Math.min(width, height) * 0.08))
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = y * width + x
        if (!definiteBg[i]) seeds[i] = cv.GC_FGD
      }
    }
  }

  return { seeds, definiteBg }
}

function seedsToBinaryMask(
  seeds: Uint8Array,
  cv: OpenCvRuntime,
  width: number,
  height: number,
  labData: Uint8Array,
  bgMean: Lab,
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  for (let i = 0; i < seeds.length; i += 1) {
    const s = seeds[i]!
    if (s === cv.GC_FGD || s === cv.GC_PR_FGD) {
      mask.data[i] = 255
    } else if (s === cv.GC_PR_BGD) {
      // Soft uncertain BG: keep partial alpha from Lab distance.
      const o = i * 3
      const d = labDist(
        { L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! },
        bgMean,
      )
      mask.data[i] = d > 10 ? Math.min(200, Math.floor(d * 8)) : 0
    } else {
      mask.data[i] = 0
    }
  }
  return mask
}

function grabCutLabelsToMask(
  labels: Uint8Array,
  cv: OpenCvRuntime,
  width: number,
  height: number,
  labData: Uint8Array,
  bgMean: Lab,
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  for (let i = 0; i < labels.length; i += 1) {
    const lab = labels[i]!
    if (lab === cv.GC_FGD || lab === cv.GC_PR_FGD) {
      mask.data[i] = 255
    } else {
      // Soft fringe only when near the decision boundary in Lab.
      const o = i * 3
      const d = labDist(
        { L: labData[o]!, a: labData[o + 1]!, b: labData[o + 2]! },
        bgMean,
      )
      if (lab === cv.GC_PR_BGD && d > 14) {
        mask.data[i] = Math.min(160, Math.floor(40 + d * 4))
      } else {
        mask.data[i] = 0
      }
    }
  }
  return mask
}

/** Soften only the silhouette ring — does not raise pure REMOVE interiors. */
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
      // Boundary pixel: blend toward mid alpha based on Lab distance.
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
 * Segment a garment photograph into a KEEP/REMOVE mask.
 * Source ImageData RGB is never modified.
 */
export async function segmentGarmentWithOpenCv(
  imageData: ImageData,
  options: SegmentGarmentOptions = {},
): Promise<SegmentGarmentResult> {
  // Default interactive path: pure JS Lab seeds — no WASM. OpenCV.js init and
  // GrabCut on the main thread hang the Batch UI ("Working…" forever).
  const wantGrabCut =
    options.allowGrabCut === true && options.forceSeedFallback !== true

  if (isNodeRuntime() || options.forceSeedFallback || !wantGrabCut) {
    return segmentGarmentBySeeds(imageData)
  }

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  let cv: OpenCvRuntime
  try {
    cv = await loadOpenCv()
  } catch {
    return segmentGarmentBySeeds(imageData)
  }
  // Keep GrabCut working canvas small — OpenCV.js stalls on large INIT_WITH_MASK.
  const maxWorkingSide = options.maxWorkingSide ?? 160
  const grabCutIters = options.grabCutIters ?? 2

  const srcW = imageData.width
  const srcH = imageData.height
  const scale = Math.min(1, maxWorkingSide / Math.max(srcW, srcH))
  const workW = Math.max(1, Math.round(srcW * scale))
  const workH = Math.max(1, Math.round(srcH * scale))

  const toFree: OpenCvMat[] = []
  const track = <T extends OpenCvMat>(m: T): T => {
    toFree.push(m)
    return m
  }

  try {
    // Clone pixels into OpenCV — do not alias the source buffer for writes.
    const rgbaCopy = {
      width: srcW,
      height: srcH,
      data: new Uint8ClampedArray(imageData.data),
    }
    const rgba = track(cv.matFromImageData(rgbaCopy))
    const rgbFull = track(new cv.Mat(srcH, srcW, cv.CV_8UC3))
    cv.cvtColor(rgba, rgbFull, cv.COLOR_RGBA2RGB)

    const labFull = track(new cv.Mat())
    cv.cvtColor(rgbFull, labFull, cv.COLOR_RGB2Lab)

    let workRgb: OpenCvMat
    let workLab: OpenCvMat
    if (scale < 1) {
      workRgb = track(new cv.Mat())
      workLab = track(new cv.Mat())
      const size = new cv.Size(workW, workH)
      cv.resize(rgbFull, workRgb, size, 0, 0, cv.INTER_LINEAR)
      cv.resize(labFull, workLab, size, 0, 0, cv.INTER_LINEAR)
    } else {
      workRgb = rgbFull
      workLab = labFull
    }

    const labData = new Uint8Array(workLab.data)
    const bg = estimateBackgroundLab(labData, workW, workH)
    const { seeds } = buildSeedMask(cv, labData, workW, workH, bg)

    let methodUsed: SegmentGarmentResult['methodUsed'] = 'opencv-seed-fallback'
    let workMask: MaskPixelBuffer

    const canGrab =
      hasGrabCut(cv) && wantGrabCut && workW * workH <= 180 * 180

    if (canGrab) {
      try {
        const gcMask = track(cv.matFromArray(workH, workW, cv.CV_8UC1, seeds))
        // OpenCV.js GrabCut GMM models must be CV_64FC1 1×65 (not CV_32FC1).
        const bgdModel = track(new cv.Mat(1, 65, cv.CV_64FC1))
        const fgdModel = track(new cv.Mat(1, 65, cv.CV_64FC1))
        if (bgdModel.data64F) bgdModel.data64F.fill(0)
        if (fgdModel.data64F) fgdModel.data64F.fill(0)
        const rect = new cv.Rect(0, 0, workW, workH)
        cv.grabCut(
          workRgb,
          gcMask,
          rect,
          bgdModel,
          fgdModel,
          Math.min(2, grabCutIters),
          cv.GC_INIT_WITH_MASK,
        )
        const labels = new Uint8Array(gcMask.data)
        workMask = grabCutLabelsToMask(labels, cv, workW, workH, labData, bg.mean)
        methodUsed = 'opencv-grabcut'
      } catch {
        workMask = seedsToBinaryMask(seeds, cv, workW, workH, labData, bg.mean)
        methodUsed = 'opencv-seed-fallback'
      }
    } else {
      workMask = seedsToBinaryMask(seeds, cv, workW, workH, labData, bg.mean)
      methodUsed = 'opencv-seed-fallback'
    }

    softenBoundary(workMask, labData, bg.mean)

    let finalMask: MaskPixelBuffer
    if (workW !== srcW || workH !== srcH) {
      const small = track(
        cv.matFromArray(workH, workW, cv.CV_8UC1, workMask.data),
      )
      const up = track(new cv.Mat())
      cv.resize(small, up, new cv.Size(srcW, srcH), 0, 0, cv.INTER_LINEAR)
      finalMask = createMaskBuffer(srcW, srcH, 0)
      finalMask.data.set(up.data)
    } else {
      finalMask = workMask
    }

    const t1 =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    return {
      mask: finalMask,
      methodUsed,
      elapsedMs: Math.round(t1 - t0),
      workingWidth: workW,
      workingHeight: workH,
    }
  } finally {
    deleteMats(...toFree)
  }
}

/**
 * Pure seed→mask path for unit tests without requiring GrabCut success.
 * Still needs OpenCV for Lab conversion.
 */
export async function segmentGarmentSeedsOnly(
  imageData: ImageData,
): Promise<SegmentGarmentResult> {
  return segmentGarmentWithOpenCv(imageData, { forceSeedFallback: true })
}
