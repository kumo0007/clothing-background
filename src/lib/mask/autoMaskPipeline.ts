/**
 * Shared auto-mask pipelines used by the UI, headless exports, and comparisons.
 *
 * - baseline: legacy threshold / flood / strip / reclaim stack
 * - opencv / auto: Lab-seed default (GrabCut opt-in only — hangs UI)
 * - isnet: local ONNX ISNet (@imgly) — opt-in until eval proves better
 *
 * Mask polarity: 255 = keep garment, 0 = replace background, gray = soft alpha.
 * Never mutates source ImageData RGB.
 */

import type { MaskPixelBuffer } from '../../types/mask'
import { createMaskBuffer } from './createMask'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
} from './refineMask'
import { refineSilhouetteBoundary } from './refineBoundary'
import {
  averageCornerColor,
  chokeMaskEdgeFringe,
  reclaimGarmentFromKeep,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
  stripBorderConnectedStudio,
  stripBorderTouchingStudioComponents,
  peelExteriorStudioKeep,
  stripDarkWalledStudioPockets,
  stripDetachedStudioIslands,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
  stripOpenArchStudio,
} from './selectSimilar'
import { segmentGarmentWithOpenCv } from './opencv/segmentGarment'
import { tryLoadOpenCv } from './opencv/loadOpenCv'
import { applyPaleCompetition } from './paleCompetition'
import { estimateMaskConfidence } from './maskConfidence'
import { runLabSeedAutoMask } from './labSeedAutoMask'
import {
  segmentGarmentWithIsnet,
  type IsnetProgressEvent,
} from './model/isnetSegment'
import {
  segmentGarmentContourFirst,
  type ContourFirstDiagnostics,
} from './contourFirst/contourFirstSegment'
import {
  refineIsnetWithEvidence,
  type IsnetRefineDiagnostics,
} from './isnetEvidenceRefine'

export type AutoMaskMethod =
  | 'baseline'
  | 'opencv'
  | 'auto'
  | 'isnet'
  | 'contour'

export type AutoMaskPipelineResult = {
  mask: MaskPixelBuffer
  methodUsed: string
  elapsedMs: number
  /** 0–1 heuristic; low values flag images for manual review */
  confidence?: number
  needsReview?: boolean
  /** Human-readable review drivers (confidence / contour policy). */
  reviewReasons?: string[]
  /** True only for genuine ONNX/GrabCut inference (never silent Lab substitute). */
  genuineModelInference?: boolean
  /** Contour-first stage diagnostics (only when methodUsed starts with contour). */
  contourDiagnostics?: ContourFirstDiagnostics
  /** Evidence-guided ISNet refinement diagnostics (methodUsed stays isnet-onnx). */
  isnetRefineDiagnostics?: IsnetRefineDiagnostics
}

export type RunOpenCvAutoMaskOptions = {
  /** Opt into main-thread GrabCut (off by default — hangs browser UI). */
  allowGrabCut?: boolean
}

export type RunAutoMaskPipelineOptions = {
  imagePath?: string
  /** ISNet first-run download / inference progress (browser). */
  onIsnetProgress?: (event: IsnetProgressEvent) => void
}

function applyLegacyCleanup(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance: number,
  opts: { fillHoles: boolean; morphClose: boolean; heavyReclaim: boolean },
): void {
  const w = imageData.width
  const h = imageData.height
  if (opts.fillHoles) {
    fillMaskHoles(mask)
  }
  if (opts.morphClose) {
    morphCloseMask(mask, 1)
  }
  const corner = averageCornerColor(imageData)
  if (opts.heavyReclaim) {
    reclaimGarmentFromKeep(
      mask,
      imageData,
      corner,
      Math.max(16, Math.floor(Math.min(w, h) / 8)),
      Math.max(14, Math.floor(tolerance * 0.45)),
    )
  }
  stripBorderConnectedStudio(mask, imageData, tolerance)
  peelExteriorStudioKeep(mask, imageData, tolerance, 24)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  chokeMaskEdgeFringe(mask, imageData, tolerance)
  removeBrightEdgeChrome(mask, imageData)
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  chokeMaskEdgeFringe(mask, imageData, tolerance, { restoreTexture: true })
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    Math.max(10, Math.floor(Math.min(w, h) / 12)),
    Math.max(14, Math.floor(tolerance * 0.45)),
  )
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  refineSilhouetteBoundary(mask, imageData, tolerance)
  stripForeignBorderBands(mask, imageData)
  featherMaskEdges(mask, 1)
}

/** Legacy corner-similarity pipeline (comparison baseline). */
export function runBaselineAutoMask(
  imageData: ImageData,
  tolerance = 40,
): AutoMaskPipelineResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const mask = createMaskBuffer(imageData.width, imageData.height, 255)
  removeSimilarToCorners(mask, imageData, tolerance)
  applyLegacyCleanup(mask, imageData, tolerance, {
    fillHoles: true,
    morphClose: true,
    heavyReclaim: true,
  })
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    mask,
    methodUsed: 'baseline',
    elapsedMs: Math.round(t1 - t0),
  }
}

/**
 * Lab-seed (default) or optional GrabCut segmentation, then selective cleanup
 * that preserves stripForeign / enclosed-studio / reclaim for handles, footers,
 * and white leather without re-running the fragile global flood.
 *
 * Default skips OpenCV.js WASM/GrabCut so Batch auto-mask cannot hang the UI.
 */
export async function runOpenCvAutoMask(
  imageData: ImageData,
  tolerance = 40,
  options: RunOpenCvAutoMaskOptions = {},
): Promise<AutoMaskPipelineResult> {
  // UI-safe default: pure JS Lab-seed (no OpenCV WASM / GrabCut hang).
  if (options.allowGrabCut !== true) {
    const seed = runLabSeedAutoMask(imageData, tolerance)
    return {
      mask: seed.mask,
      methodUsed: seed.methodUsed,
      elapsedMs: seed.elapsedMs,
      confidence: seed.confidence,
      needsReview: seed.needsReview,
      reviewReasons: seed.reviewReasons,
      genuineModelInference: false,
    }
  }

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const seg = await segmentGarmentWithOpenCv(imageData, {
    allowGrabCut: true,
    forceSeedFallback: false,
  })
  // If GrabCut could not run, fall back to the shared Lab-seed pipeline.
  if (seg.methodUsed === 'opencv-seed-fallback') {
    const seed = runLabSeedAutoMask(imageData, tolerance)
    return {
      mask: seed.mask,
      methodUsed: seed.methodUsed,
      elapsedMs: seed.elapsedMs,
      confidence: seed.confidence,
      needsReview: seed.needsReview,
      reviewReasons: seed.reviewReasons,
      genuineModelInference: false,
    }
  }

  // GrabCut succeeded — light catalog cleanup (keep soft edges).
  const mask = seg.mask
  const corner = averageCornerColor(imageData)
  fillMaskHoles(mask)
  applyPaleCompetition(mask, imageData)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripForeignBorderBands(mask, imageData)
  reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    Math.max(12, Math.floor(Math.min(imageData.width, imageData.height) / 10)),
    Math.max(12, Math.floor(tolerance * 0.4)),
  )
  featherMaskEdges(mask, 1)
  const confidence = estimateMaskConfidence(mask, imageData)
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    mask,
    methodUsed: seg.methodUsed,
    elapsedMs: Math.round(t1 - t0),
    confidence: confidence.score,
    needsReview: confidence.needsReview,
    reviewReasons: confidence.reasons,
    genuineModelInference: true,
  }
}

/**
 * ISNet ONNX path: model soft alpha → light catalog cleanup → evidence-guided
 * Lab/contour refinement (optional accept). Does NOT silently substitute Lab
 * inference. Throws on model failure — caller must not pretend Lab ran.
 *
 * `methodUsed` remains `isnet-onnx` even when refinement is accepted; see
 * `isnetRefineDiagnostics` for refinement ops / accept-reject reasons.
 */
export async function runIsnetAutoMask(
  imageData: ImageData,
  tolerance = 40,
  modelId = 'medium',
  imagePath?: string,
  onIsnetProgress?: (event: IsnetProgressEvent) => void,
): Promise<AutoMaskPipelineResult> {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const seg = await segmentGarmentWithIsnet(imageData, modelId, imagePath, {
    onProgress: onIsnetProgress,
  })
  const mask = seg.mask
  // Preserve footer-band cleanup required by catalog scrapes.
  stripForeignBorderBands(mask, imageData)
  removeBrightEdgeChrome(mask, imageData)
  stripOpenArchStudio(mask, imageData, tolerance)
  // Tiny feather only — do not erode silhouette.
  featherMaskEdges(mask, 1)

  const refined = refineIsnetWithEvidence(mask, imageData)
  // Copy accepted (or original) pixels back into the working buffer.
  mask.data.set(refined.mask.data)
  const diag = refined.diagnostics

  const confidence = estimateMaskConfidence(mask, imageData)
  const reviewReasons = [...confidence.reasons]
  if (!diag.refinementAccepted && diag.failureModes.length > 0) {
    reviewReasons.push(
      `isnet-refine-rejected: ${diag.rejectReason ?? 'ambiguous'} (${diag.failureModes.join(',')})`,
    )
  }
  if (diag.refinementAccepted && diag.acceptReason) {
    // Refinement ran — do not clear confidence reasons; only note accept.
    reviewReasons.push(`isnet-refine-accepted: ${diag.acceptReason}`)
  }
  // needsReview: confidence policy; rejected refine only for strong geometry /
  // contamination modes (not mere "ambiguous" or mild Lab disagreement on
  // clean dark garments); accepted refine that still leaves residual gaps.
  // Residual dark bites alone must not flag an already-acceptable mask when
  // refine rejected ambiguous Lab nibbles (blazer) — only when we attempted a
  // dark-bite repair, still have possible-under-recall, or accepted refine.
  const strongUnresolved =
    !diag.refinementAccepted &&
    diag.failureModes.some(
      (m) =>
        m === 'stacked-keep-components' ||
        m === 'lab-disagrees-studio-keep' ||
        m === 'contour-bg-contamination',
    )
  const residualAfterAccept =
    diag.refinementAccepted &&
    (diag.failureModes.includes('residual-lab-garment-gaps') ||
      diag.failureModes.includes('residual-dark-exterior-bites'))
  const residualDarkBitesNeedReview =
    diag.failureModes.includes('residual-dark-exterior-bites') &&
    (diag.refinementAccepted ||
      (diag.gateValues.darkBiteReclaimed ?? 0) > 0 ||
      diag.failureModes.includes('possible-under-recall'))
  // Large under-recall reclaim can leave jagged hem/edge noise (coat). Mask
  // stays; flag for operator QC rather than claiming unattended ready.
  const largeUnderRecallNeedsReview =
    diag.refinementAccepted &&
    (diag.refinementCategory === 'under-recall' ||
      (diag.acceptReason?.includes('reclaimed-under-recall') ?? false)) &&
    diag.deltaFgRatio >= 0.05
  if (largeUnderRecallNeedsReview) {
    reviewReasons.push(
      'large-under-recall-accepted: boundary QC recommended',
    )
  }
  const needsReview =
    confidence.needsReview ||
    strongUnresolved ||
    residualAfterAccept ||
    residualDarkBitesNeedReview ||
    largeUnderRecallNeedsReview
  if (residualAfterAccept) {
    reviewReasons.push(
      `residual-after-refine: ${diag.failureModes
        .filter(
          (m) =>
            m === 'residual-lab-garment-gaps' ||
            m === 'residual-dark-exterior-bites',
        )
        .join(',')}`,
    )
  }

  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    mask,
    methodUsed: seg.methodUsed,
    elapsedMs: Math.round(t1 - t0),
    confidence: confidence.score,
    needsReview,
    reviewReasons,
    genuineModelInference: true,
    isnetRefineDiagnostics: diag,
  }
}

/**
 * Contour-first opt-in path. Edge-barrier silhouette → fill → refine.
 * Does not become default until eval proves white-on-white wins.
 * Never silently swaps to Lab/ISNet; diagnostics always report acceptance.
 */
export function runContourFirstAutoMask(
  imageData: ImageData,
  _tolerance = 40,
): AutoMaskPipelineResult {
  const result = segmentGarmentContourFirst(imageData)
  return {
    mask: result.mask,
    methodUsed: result.methodUsed,
    elapsedMs: result.elapsedMs,
    confidence: result.confidence,
    needsReview: result.needsReview,
    reviewReasons: result.diagnostics.reviewReasons,
    genuineModelInference: false,
    contourDiagnostics: result.diagnostics,
  }
}

/**
 * Preferred entry for UI + batch.
 *
 * - auto / opencv: Lab-seed hybrid + cleanup (no WASM wait — GrabCut hangs UI)
 * - isnet: local ONNX ISNet (opt-in; AGPL package) — fails loudly if unavailable
 * - contour: contour-first edge-barrier silhouette (opt-in; not default)
 * - baseline: legacy corner flood
 *
 * Default remains Lab-seed until contour-first / ISNet demonstrate safe wins.
 */
export async function runAutoMaskPipeline(
  imageData: ImageData,
  method: AutoMaskMethod = 'auto',
  tolerance = 40,
  options: RunAutoMaskPipelineOptions = {},
): Promise<AutoMaskPipelineResult> {
  if (method === 'baseline') {
    return runBaselineAutoMask(imageData, tolerance)
  }

  if (method === 'isnet') {
    // Never silently fall back — report the real limitation instead.
    return runIsnetAutoMask(
      imageData,
      tolerance,
      'medium',
      options.imagePath,
      options.onIsnetProgress,
    )
  }

  if (method === 'contour') {
    return runContourFirstAutoMask(imageData, tolerance)
  }

  if (method === 'opencv' || method === 'auto') {
    try {
      // Never await tryLoadOpenCv() here — WASM init freezes Batch "Working…".
      return await runOpenCvAutoMask(imageData, tolerance, {
        allowGrabCut: false,
      })
    } catch (err) {
      if (method === 'opencv') {
        // Explicit opencv: one more attempt after probing load, still seed-only.
        const cv = await tryLoadOpenCv()
        if (!cv) {
          throw err instanceof Error
            ? err
            : new Error('OpenCV auto-mask failed')
        }
      }
      return runBaselineAutoMask(imageData, tolerance)
    }
  }

  return runBaselineAutoMask(imageData, tolerance)
}
