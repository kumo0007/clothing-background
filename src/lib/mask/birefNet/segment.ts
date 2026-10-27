import type { MaskPixelBuffer } from '../../../types/mask'
import { loadHtmlImage } from '../../image/loadHtmlImage'
import { imageDataFromObjectUrl } from '../../image/imageDataFromUrl'
import { reviewSdkMask } from '../sdkMaskReview'
import {
  BIREFNET_METHOD,
  BIREFNET_PROVIDER,
} from './constants'
import {
  imageDataFromCanvasDraw,
  preprocessImageDataToBirefNetTensor,
} from './preprocess'
import {
  assertUsableMask,
  logitsToMaskBuffer,
} from './postprocess'
import { refineTexturedBorderLeak } from './refineTexturedBorderLeak'
import {
  preloadBirefNetModel,
  runBirefNetInference,
  type BirefNetDevice,
  type BirefNetProgress,
} from './session'
import { resizeMaskNearest } from '../apiTransparentPngMask'

export type BirefNetSegmentResult = {
  mask: MaskPixelBuffer
  methodUsed: typeof BIREFNET_METHOD
  provider: typeof BIREFNET_PROVIDER
  confidence: number
  needsReview: boolean
  reviewReasons: string[]
  findings: import('../diagnostics/types').DiagnosticFinding[]
  diagnostics: import('../diagnostics/types').MaskDiagnostics
  genuineModelInference: true
  device: BirefNetDevice | 'unknown'
  resized: boolean
  elapsedMs: number
}

async function resolveSourceImageData(
  imageBlob: Blob,
  sourceWidth: number,
  sourceHeight: number,
  provided?: ImageData,
): Promise<ImageData> {
  if (
    provided &&
    provided.width === sourceWidth &&
    provided.height === sourceHeight
  ) {
    return provided
  }

  // Prefer capped decode for memory; preprocess will resize to 512 anyway.
  const maxEdge = 1600
  const long = Math.max(sourceWidth, sourceHeight)
  const scale = long > maxEdge ? maxEdge / long : 1
  const dw = Math.max(1, Math.round(sourceWidth * scale))
  const dh = Math.max(1, Math.round(sourceHeight * scale))

  const url = URL.createObjectURL(imageBlob)
  try {
    try {
      return await imageDataFromObjectUrl(url, dw, dh)
    } catch {
      const img = await loadHtmlImage(url)
      return imageDataFromCanvasDraw(img, dw, dh)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Segment one image with BiRefNet_lite (browser ONNX).
 * Produces MaskPixelBuffer only — never mutates source RGB.
 */
export async function segmentWithBirefNet(
  imageBlob: Blob,
  sourceWidth: number,
  sourceHeight: number,
  options: {
    onProgress?: (event: BirefNetProgress) => void
    sourceImageData?: ImageData
  } = {},
): Promise<BirefNetSegmentResult> {
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('Invalid source image dimensions for BiRefNet.')
  }
  if (imageBlob.size === 0) {
    throw new Error('Empty image for BiRefNet.')
  }

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  await preloadBirefNetModel(options.onProgress)

  const sourceImageData = await resolveSourceImageData(
    imageBlob,
    sourceWidth,
    sourceHeight,
    options.sourceImageData,
  )

  options.onProgress?.({
    kind: 'birefnet-process',
    stage: 'Preprocessing for BiRefNet…',
  })
  const tensor = preprocessImageDataToBirefNetTensor(sourceImageData)

  const {
    logits,
    width: mw,
    height: mh,
    device,
    fallbackReason: epFallback,
  } = await runBirefNetInference(tensor, options.onProgress)

  options.onProgress?.({
    kind: 'birefnet-process',
    stage: 'Building soft alpha mask…',
  })

  let mask = logitsToMaskBuffer(
    logits,
    mw,
    mh,
    sourceWidth,
    sourceHeight,
  )
  assertUsableMask(mask)

  // Do NOT run repairSdkUnderRecall here. Diagnosis
  // (tmp-model-eval/birefnet-diagnose-2026-10-27) showed it fires on healthy
  // BiRefNet soft edges (thin-keep-corridor / pale-gap) and lowers heuristic
  // IoU on every sampled fixture while growing KEEP 3–11%. That helper is for
  // RMBG-style under-recall in bgRemoveSdk — not this checkpoint.

  // Expected model upsample (512 → source). Suspicious only if dims are wrong.
  const expectedResample = mw !== sourceWidth || mh !== sourceHeight
  const resizedSuspicious =
    mask.width !== sourceWidth || mask.height !== sourceHeight

  // Color-aware refine/diagnostics need matching RGB. Prefer full-res source;
  // when decode was capped for memory, downscale the mask for refine only and
  // write peeled pixels back via nearest upsample of the delta (border-only).
  const fullResRgb =
    options.sourceImageData &&
    options.sourceImageData.width === mask.width &&
    options.sourceImageData.height === mask.height
      ? options.sourceImageData
      : sourceImageData.width === mask.width &&
          sourceImageData.height === mask.height
        ? sourceImageData
        : undefined

  let texturedNote: string | undefined
  if (fullResRgb) {
    const refined = refineTexturedBorderLeak(mask, fullResRgb)
    if (refined.applied) {
      mask = refined.mask
      texturedNote = refined.reason
    }
  } else if (
    sourceImageData.width > 0 &&
    sourceImageData.height > 0 &&
    (sourceImageData.width !== mask.width ||
      sourceImageData.height !== mask.height)
  ) {
    // Cap path: refine on matching dims, then map removed pixels back.
    const small = resizeMaskNearest(
      mask,
      sourceImageData.width,
      sourceImageData.height,
    )
    const beforeSmall = new Uint8ClampedArray(small.data)
    const refined = refineTexturedBorderLeak(small, sourceImageData)
    if (refined.applied) {
      const up = resizeMaskNearest(refined.mask, mask.width, mask.height)
      const beforeUp = resizeMaskNearest(
        { width: small.width, height: small.height, data: beforeSmall },
        mask.width,
        mask.height,
      )
      const next = {
        width: mask.width,
        height: mask.height,
        data: new Uint8ClampedArray(mask.data),
      }
      for (let i = 0; i < next.data.length; i += 1) {
        // Only clear pixels that the refine peeled (were KEEP, now BG).
        if (beforeUp.data[i]! >= 128 && up.data[i]! < 128) {
          next.data[i] = 0
        }
      }
      mask = next
      texturedNote = refined.reason
    }
  }

  assertUsableMask(mask)

  // Color-aware diagnostics require matching dims. Prefer full-res RGB; else
  // use the capped decode + a nearest-resized mask clone (mask store stays full-res).
  let reviewMask = mask
  let reviewImage = fullResRgb
  if (
    !reviewImage &&
    (sourceImageData.width !== mask.width ||
      sourceImageData.height !== mask.height)
  ) {
    reviewMask = resizeMaskNearest(
      mask,
      sourceImageData.width,
      sourceImageData.height,
    )
    reviewImage = sourceImageData
  } else if (!reviewImage) {
    reviewImage = sourceImageData
  }

  const review = reviewSdkMask(reviewMask, reviewImage, {
    resized: expectedResample || resizedSuspicious,
    resizedSuspicious,
    method: BIREFNET_METHOD,
  })

  const reviewReasons = [...review.reasons]
  if (epFallback) reviewReasons.push(epFallback)
  if (texturedNote) reviewReasons.push(texturedNote)

  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    mask,
    methodUsed: BIREFNET_METHOD,
    provider: BIREFNET_PROVIDER,
    confidence: review.score,
    needsReview: review.needsReview,
    reviewReasons,
    findings: review.findings,
    diagnostics: review.diagnostics,
    genuineModelInference: true,
    device,
    resized: expectedResample || resizedSuspicious,
    elapsedMs: Math.round(t1 - t0),
  }
}

export { preloadBirefNetModel }
export type { BirefNetProgress }
