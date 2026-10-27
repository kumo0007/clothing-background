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
import {
  preloadBirefNetModel,
  runBirefNetInference,
  type BirefNetDevice,
  type BirefNetProgress,
} from './session'

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

  const mask = logitsToMaskBuffer(
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

  const reviewRgb: ImageData | undefined =
    options.sourceImageData &&
    options.sourceImageData.width === mask.width &&
    options.sourceImageData.height === mask.height
      ? options.sourceImageData
      : sourceImageData.width === mask.width &&
          sourceImageData.height === mask.height
        ? sourceImageData
        : undefined

  const review = reviewSdkMask(mask, reviewRgb, {
    resized: true,
    method: BIREFNET_METHOD,
  })

  const reviewReasons = [...review.reasons]
  if (epFallback) reviewReasons.push(epFallback)

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
    resized: true,
    elapsedMs: Math.round(t1 - t0),
  }
}

export { preloadBirefNetModel }
export type { BirefNetProgress }
