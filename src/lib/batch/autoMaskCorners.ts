import { loadHtmlImage } from '../image/loadHtmlImage'
import { getOrCreateMask, setMask } from '../mask/maskStore'
import {
  runAutoMaskPipeline,
  type AutoMaskMethod,
} from '../mask/autoMaskPipeline'
import type { IsnetProgressEvent } from '../mask/model/isnetSegment'

export type { AutoMaskMethod }

export type AutoMaskProgress = {
  kind: 'isnet-download'
  key: string
  current: number
  total: number
}

/**
 * Auto-mask one image and commit the mask to `maskStore` under `imageId`.
 *
 * Default `method` is `'auto'` (Lab-seed / opencv-seed-fallback). Contour-first
 * and ISNet are opt-in only — callers must pass `method: 'contour' | 'isnet'`
 * explicitly. There is no silent substitution of Lab-seed when those fail
 * (ISNet throws; contour reports diagnostics / may fall back to seed with
 * needsReview). Never rewrites garment RGB.
 */
export type AutoMaskCornersResult = {
  confidence: number
  needsReview: boolean
  /** Strategy requested by the caller. */
  requestedMethod: AutoMaskMethod
  /** Strategy that actually produced the mask (`result.methodUsed`). */
  methodUsed: string
  genuineModelInference: boolean
  /** Contour reject / fallback note for UI (when applicable). */
  reviewReason?: string
}

export async function autoMaskCornersForImage(
  imageId: string,
  objectUrl: string,
  width: number,
  height: number,
  tolerance = 40,
  method: AutoMaskMethod = 'auto',
  onProgress?: (event: AutoMaskProgress) => void,
): Promise<AutoMaskCornersResult> {
  const image = await loadHtmlImage(objectUrl)
  const probe = document.createElement('canvas')
  probe.width = width
  probe.height = height
  const ctx = probe.getContext('2d')
  if (!ctx) {
    throw new Error('Could not read image pixels')
  }
  ctx.drawImage(image, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)

  // Ensure store entry exists at the correct dimensions before replace.
  getOrCreateMask(imageId, width, height)
  const result = await runAutoMaskPipeline(imageData, method, tolerance, {
    onIsnetProgress: (event: IsnetProgressEvent) => {
      onProgress?.({
        kind: 'isnet-download',
        key: event.key,
        current: event.current,
        total: event.total,
      })
    },
  })
  setMask(imageId, result.mask)
  const diag = result.contourDiagnostics
  const isnetDiag = result.isnetRefineDiagnostics
  let reviewReason: string | undefined
  if (diag && !diag.contourAccepted) {
    reviewReason =
      diag.fallbackReason ??
      (diag.rejectReason
        ? `contour rejected: ${diag.rejectReason}`
        : undefined)
  } else if (result.needsReview) {
    const reasons =
      result.reviewReasons ??
      diag?.reviewReasons ??
      []
    reviewReason =
      reasons.length > 0
        ? reasons.join('; ')
        : 'uncertain auto-mask — review recommended'
  }
  // When ISNet refine rejects with failure modes, ensure reason is present.
  if (
    !reviewReason &&
    result.needsReview &&
    isnetDiag &&
    !isnetDiag.refinementAccepted &&
    isnetDiag.rejectReason
  ) {
    reviewReason = `isnet-refine-rejected: ${isnetDiag.rejectReason}`
  }
  return {
    confidence: result.confidence ?? 0.5,
    needsReview: result.needsReview === true,
    requestedMethod: method,
    methodUsed: result.methodUsed,
    genuineModelInference: result.genuineModelInference === true,
    reviewReason,
  }
}
