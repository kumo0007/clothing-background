/**
 * Review policy for bg-remove-sdk (RMBG).
 * Detection only — never mutates mask pixels. Border peel is explicit via
 * `previewBorderStudioPeel` / `applyBorderStudioPeel`.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { runMaskDiagnostics } from './diagnostics/runMaskDiagnostics'
import type { DiagnosticFinding, MaskDiagnostics } from './diagnostics/types'
import {
  previewBorderStudioPeel,
  applyBorderStudioPeel,
  type BorderPeelPreview,
} from './diagnostics/borderStudioRepair'

export type SdkMaskReview = {
  /** Heuristic review score — not calibrated model confidence. */
  score: number
  heuristicScore: number
  needsReview: boolean
  reasons: string[]
  findings: DiagnosticFinding[]
  diagnostics: MaskDiagnostics
  /** Always false — review no longer auto-peels. */
  refined: false
}

/**
 * Score an SDK mask for operator review. Prefer real source RGB.
 * Does **not** modify `mask`.
 */
export function reviewSdkMask(
  mask: MaskPixelBuffer,
  sourceImageData: ImageData | undefined,
  extras: {
    resized?: boolean
    resizedSuspicious?: boolean
    method?: string
    maskRevision?: number
    hasManualEdits?: boolean
  } = {},
): SdkMaskReview {
  const diagnostics = runMaskDiagnostics({
    mask,
    imageData: sourceImageData,
    profile: 'neural',
    method: extras.method ?? 'birefnet-lite-512',
    resized: extras.resized ?? false,
    resizedSuspicious: extras.resizedSuspicious ?? false,
    maskRevision: extras.maskRevision,
    hasManualEdits: extras.hasManualEdits,
  })

  return {
    score: diagnostics.heuristicScore,
    heuristicScore: diagnostics.heuristicScore,
    needsReview: diagnostics.needsReview,
    reasons: diagnostics.reviewReasons,
    findings: diagnostics.findings,
    diagnostics,
    refined: false,
  }
}

export {
  previewBorderStudioPeel,
  applyBorderStudioPeel,
  type BorderPeelPreview,
}

/** @deprecated Use previewBorderStudioPeel — kept for tests expecting the name. */
export function maybeStripSdkBorderStudio(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): { mask: MaskPixelBuffer; refined: boolean; stripped: number } {
  const preview = previewBorderStudioPeel(mask, imageData)
  return {
    mask: preview.recommendApply ? preview.candidate : mask,
    refined: preview.recommendApply,
    stripped: preview.stripped,
  }
}
