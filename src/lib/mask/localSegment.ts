/**
 * Local, non-AI auto-segmentation adapter for Batch → Auto-mask.
 *
 * No qualifying published commercial “background-removal SDK” without AI/ML
 * was verified. This adapter wraps the app’s classical Lab-seed pipeline
 * (`runLabSeedAutoMask`): pure JS, no network, no ONNX, no OpenCV WASM.
 *
 * Mask polarity: 255 KEEP garment, 0 background, gray = soft alpha.
 * Never mutates source ImageData RGB.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { cloneMaskBuffer } from './createMask'
import { runLabSeedAutoMask } from './labSeedAutoMask'

export const LOCAL_SEGMENT_METHOD = 'opencv-seed-fallback'
export const LOCAL_SEGMENT_PROVIDER = 'local-lab-seed'

export type LocalSegmentationResult = {
  mask: MaskPixelBuffer
  methodUsed: string
  provider: typeof LOCAL_SEGMENT_PROVIDER
  confidence: number
  needsReview: boolean
  reviewReasons: string[]
  genuineModelInference: false
  elapsedMs: number
}

export type LocalSegmentProgress = {
  kind: 'local-decode' | 'local-segment'
  current: number
  total: number
}

/**
 * Segment a decoded ImageData locally into a KEEP mask.
 * Callers own decoding (object URL → ImageData) so tests can inject fixtures.
 */
export async function segmentImageLocally(
  imageData: ImageData,
  options: {
    tolerance?: number
    onProgress?: (event: LocalSegmentProgress) => void
  } = {},
): Promise<LocalSegmentationResult> {
  if (imageData.width < 1 || imageData.height < 1) {
    throw new Error('Invalid image dimensions for local auto-mask.')
  }
  if (imageData.data.length < imageData.width * imageData.height * 4) {
    throw new Error('Image pixel buffer is too small for its dimensions.')
  }

  const rgbProbe = new Uint8ClampedArray(Math.min(64, imageData.data.length))
  rgbProbe.set(imageData.data.subarray(0, rgbProbe.length))

  options.onProgress?.({ kind: 'local-segment', current: 0, total: 1 })

  // Yield so React can paint progress before CPU-heavy seed work.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

  const result = runLabSeedAutoMask(imageData, options.tolerance ?? 40)

  for (let i = 0; i < rgbProbe.length; i += 1) {
    if (imageData.data[i] !== rgbProbe[i]) {
      throw new Error(
        'Local auto-mask mutated source RGB — aborting to protect the original.',
      )
    }
  }

  options.onProgress?.({ kind: 'local-segment', current: 1, total: 1 })

  const methodUsed = result.methodUsed || LOCAL_SEGMENT_METHOD
  if (/isnet|api-poof|remove\.bg|poof|grabcut/i.test(methodUsed)) {
    throw new Error(
      `Local auto-mask produced unexpected methodUsed "${methodUsed}".`,
    )
  }

  return {
    mask: cloneMaskBuffer(result.mask),
    methodUsed,
    provider: LOCAL_SEGMENT_PROVIDER,
    confidence: result.confidence,
    needsReview: result.needsReview,
    reviewReasons: [...result.reviewReasons],
    genuineModelInference: false,
    elapsedMs: result.elapsedMs,
  }
}
