import type { UploadedImage } from '../../types'
import type { MaskStateMeta } from '../../types/mask'

export type AutoMaskScope = 'all' | 'failed' | 'selected'

type ProjectLike = { maskMeta: MaskStateMeta }

/**
 * Build the auto-mask work queue from current image ids (not stale indexes).
 *
 * - `all`: unmasked or previously failed only — never overwrite a successful
 *   or manually edited mask without an explicit failed/selected retry path.
 * - `failed`: autoFailed only.
 * - `selected`: the selected image when it is eligible (unmasked or failed);
 *   skips successful/manual masks.
 */
export function buildAutoMaskQueue(
  images: UploadedImage[],
  projects: Record<string, ProjectLike | undefined>,
  scope: AutoMaskScope,
  selectedId: string | null,
): UploadedImage[] {
  const eligible = (image: UploadedImage): boolean => {
    const meta = projects[image.id]?.maskMeta
    if (!meta) return true
    if (meta.autoFailed) return true
    if (meta.hasManualEdits) return false
    if (meta.hasEdits) return false
    return true
  }

  if (scope === 'all') {
    return images.filter(eligible)
  }

  if (scope === 'failed') {
    return images.filter(
      (image) => projects[image.id]?.maskMeta.autoFailed === true,
    )
  }

  // selected
  if (!selectedId) return []
  const selected = images.find((image) => image.id === selectedId)
  if (!selected) return []
  return eligible(selected) ? [selected] : []
}

function isInFlightPhase(phase: MaskStateMeta['processingPhase']): boolean {
  return phase === 'processing' || phase === 'loading-model'
}

/**
 * Images waiting for a first successful auto-mask and not currently running.
 * In-flight (`processing` / `loading-model`) are excluded so the UI does not
 * look stuck at “8 pending” while image 1 is actually inferencing.
 */
export function countPendingMasks(
  images: UploadedImage[],
  projects: Record<string, ProjectLike | undefined>,
): number {
  return images.reduce((count, image) => {
    const meta = projects[image.id]?.maskMeta
    if (meta?.hasEdits && !meta.autoFailed) return count
    if (meta?.autoFailed) return count
    if (isInFlightPhase(meta?.processingPhase)) return count
    return count + 1
  }, 0)
}

/** Images currently loading the model or running inference. */
export function countInFlightMasks(
  images: UploadedImage[],
  projects: Record<string, ProjectLike | undefined>,
): number {
  return images.reduce((count, image) => {
    const meta = projects[image.id]?.maskMeta
    if (isInFlightPhase(meta?.processingPhase)) return count + 1
    return count
  }, 0)
}
