/**
 * Explicit, conservative border-studio peel. Never runs during diagnostics.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { stripBorderConnectedStudio } from '../selectSimilar'
import { computeMaskMetrics } from './maskMetrics'
import { runMaskDiagnostics } from './runMaskDiagnostics'

function cloneMask(mask: MaskPixelBuffer): MaskPixelBuffer {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  }
}

function keepCount(mask: MaskPixelBuffer): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) n += 1
  }
  return n
}

export type BorderPeelPreview = {
  /** Candidate mask — not written to maskStore until commit. */
  candidate: MaskPixelBuffer
  stripped: number
  keepBefore: number
  keepAfter: number
  borderStudioBefore: number
  borderStudioAfter: number
  /** False when peel is unsafe or ineffective. */
  recommendApply: boolean
  reason: string
}

/**
 * Preview a border-connected studio peel. Does not mutate `mask`.
 */
export function previewBorderStudioPeel(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): BorderPeelPreview {
  const before = computeMaskMetrics(mask, imageData, {
    neuralFringeBorderOnly: true,
  })
  const keepBefore = keepCount(mask)
  const candidate = cloneMask(mask)
  const stripped = stripBorderConnectedStudio(candidate, imageData, tolerance)
  const keepAfter = keepCount(candidate)
  const after = computeMaskMetrics(candidate, imageData, {
    neuralFringeBorderOnly: true,
  })

  if (before.borderStudioRatio <= 0.08) {
    return {
      candidate: cloneMask(mask),
      stripped: 0,
      keepBefore,
      keepAfter: keepBefore,
      borderStudioBefore: before.borderStudioRatio,
      borderStudioAfter: before.borderStudioRatio,
      recommendApply: false,
      reason: 'Border studio ratio already at/below threshold (0.08)',
    }
  }

  if (stripped < 8) {
    return {
      candidate: cloneMask(mask),
      stripped,
      keepBefore,
      keepAfter: keepBefore,
      borderStudioBefore: before.borderStudioRatio,
      borderStudioAfter: before.borderStudioRatio,
      recommendApply: false,
      reason: 'Peel removed too few pixels to matter',
    }
  }

  if (keepAfter < keepBefore * 0.92) {
    return {
      candidate: cloneMask(mask),
      stripped,
      keepBefore,
      keepAfter,
      borderStudioBefore: before.borderStudioRatio,
      borderStudioAfter: after.borderStudioRatio,
      recommendApply: false,
      reason: 'Peel would shrink KEEP by more than 8% — rejected as unsafe',
    }
  }

  if (after.borderStudioRatio >= before.borderStudioRatio - 0.01) {
    return {
      candidate: cloneMask(mask),
      stripped,
      keepBefore,
      keepAfter,
      borderStudioBefore: before.borderStudioRatio,
      borderStudioAfter: after.borderStudioRatio,
      recommendApply: false,
      reason: 'Peel did not meaningfully reduce border studio KEEP',
    }
  }

  return {
    candidate,
    stripped,
    keepBefore,
    keepAfter,
    borderStudioBefore: before.borderStudioRatio,
    borderStudioAfter: after.borderStudioRatio,
    recommendApply: true,
    reason: `Safe peel: −${stripped} studio px, border studio ${(before.borderStudioRatio * 100).toFixed(1)}% → ${(after.borderStudioRatio * 100).toFixed(1)}%`,
  }
}

/**
 * Apply a previously previewed candidate into `target` (in place).
 * Caller must push undo history first.
 */
export function applyBorderStudioPeel(
  target: MaskPixelBuffer,
  candidate: MaskPixelBuffer,
): void {
  if (
    target.width !== candidate.width ||
    target.height !== candidate.height ||
    target.data.length !== candidate.data.length
  ) {
    throw new Error('Border peel candidate dimensions do not match target mask')
  }
  target.data.set(candidate.data)
}

/** Re-run diagnostics after a committed peel. */
export function diagnosticsAfterPeel(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  method: string,
): ReturnType<typeof runMaskDiagnostics> {
  return runMaskDiagnostics({
    mask,
    imageData,
    profile: 'neural',
    method,
    resized: false,
  })
}
