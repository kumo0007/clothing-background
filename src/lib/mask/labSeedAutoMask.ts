/**
 * Classical Lab-seed auto-mask used by the UI Batch path.
 *
 * Pure JS seed segmentation + catalog cleanup — no OpenCV WASM, GrabCut,
 * ONNX, or network. Suitable for commercial in-browser use as first-party code.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import {
  featherMaskEdges,
  fillMaskHoles,
} from './refineMask'
import { refineSilhouetteBoundary } from './refineBoundary'
import {
  averageCornerColor,
  chokeMaskEdgeFringe,
  reclaimGarmentFromKeep,
  removeBrightEdgeChrome,
  chokeBrightStudioBesideDark,
  stripBorderConnectedStudio,
  stripBorderTouchingStudioComponents,
  peelExteriorStudioKeep,
  stripDarkWalledStudioPockets,
  stripDetachedStudioIslands,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
  stripOpenArchStudio,
} from './selectSimilar'
import { applyPaleCompetition } from './paleCompetition'
import { estimateMaskConfidence } from './maskConfidence'
import { segmentGarmentBySeeds } from './opencv/segmentSeeds'

export type LabSeedAutoMaskResult = {
  mask: MaskPixelBuffer
  methodUsed: string
  elapsedMs: number
  confidence: number
  needsReview: boolean
  reviewReasons: string[]
}

/**
 * Lab-seed garment mask + the same selective cleanup used by the historical
 * UI-safe OpenCV seed path (GrabCut never enabled here).
 */
export function runLabSeedAutoMask(
  imageData: ImageData,
  tolerance = 40,
): LabSeedAutoMaskResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const seg = segmentGarmentBySeeds(imageData)
  const mask = seg.mask

  const corner = averageCornerColor(imageData)
  const w = imageData.width
  const h = imageData.height

  fillMaskHoles(mask)
  applyPaleCompetition(mask, imageData)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  chokeBrightStudioBesideDark(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    Math.max(16, Math.floor(Math.min(w, h) / 8)),
    Math.max(16, Math.floor(tolerance * 0.5)),
  )
  applyPaleCompetition(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  peelExteriorStudioKeep(mask, imageData, tolerance, 24)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  chokeBrightStudioBesideDark(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  chokeMaskEdgeFringe(mask, imageData, tolerance, { restoreTexture: true })
  removeBrightEdgeChrome(mask, imageData)
  applyPaleCompetition(mask, imageData)
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  peelExteriorStudioKeep(mask, imageData, tolerance, 24)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  chokeBrightStudioBesideDark(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    Math.max(8, Math.floor(Math.min(w, h) / 14)),
    Math.max(12, Math.floor(tolerance * 0.4)),
  )
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  chokeBrightStudioBesideDark(mask, imageData, tolerance)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  refineSilhouetteBoundary(mask, imageData, tolerance)
  stripForeignBorderBands(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  chokeBrightStudioBesideDark(mask, imageData, tolerance, 4)
  stripDarkWalledStudioPockets(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
  reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    Math.max(12, Math.floor(Math.min(w, h) / 10)),
    Math.max(12, Math.floor(tolerance * 0.4)),
  )
  applyPaleCompetition(mask, imageData)
  stripForeignBorderBands(mask, imageData)
  applyPaleCompetition(mask, imageData)
  stripBorderConnectedStudio(mask, imageData, tolerance)
  peelExteriorStudioKeep(mask, imageData, tolerance, 32)
  stripBorderTouchingStudioComponents(mask, imageData, tolerance)
  stripOpenArchStudio(mask, imageData, tolerance)
  stripDetachedStudioIslands(mask, imageData, tolerance)
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
  }
}
