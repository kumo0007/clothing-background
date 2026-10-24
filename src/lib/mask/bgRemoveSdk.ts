/**
 * Browser-local background removal via `bg-remove-sdk` (RMBG-1.4 + transformers.js).
 *
 * - Inference runs in a Web Worker (WebGPU when available, WASM fallback).
 * - One shared `BgRemover` instance for the page (model loaded once).
 * - Images never leave the device; only model weights download from HF (or a mirror).
 *
 * Commercial note: the SDK is MIT, but the default model `briaai/RMBG-1.4` is
 * Creative Commons for non-commercial use; commercial use requires a BRIA license.
 */
import { createBgRemover, type BgRemover, type InitState } from 'bg-remove-sdk'
import type { MaskPixelBuffer } from '../../types/mask'
import { maskFromTransparentRgba } from './apiTransparentPngMask'
import { reviewSdkMask } from './sdkMaskReview'
import { imageDataFromObjectUrl } from '../image/imageDataFromUrl'

export const BG_REMOVE_SDK_METHOD = 'bg-remove-sdk-rmbg1.4'
export const BG_REMOVE_SDK_PROVIDER = 'bg-remove-sdk'

export type BgRemoveSdkProgress =
  | {
      kind: 'sdk-init'
      status: InitState['status']
      message?: string
      /** 0–1 while downloading */
      ratio?: number
      device?: 'webgpu' | 'wasm'
    }
  | {
      kind: 'sdk-process'
      stage: string
      ratio?: number
    }

export type BgRemoveSdkResult = {
  mask: MaskPixelBuffer
  methodUsed: typeof BG_REMOVE_SDK_METHOD
  provider: typeof BG_REMOVE_SDK_PROVIDER
  confidence: number
  needsReview: boolean
  reviewReasons: string[]
  findings: import('./diagnostics/types').DiagnosticFinding[]
  diagnostics: import('./diagnostics/types').MaskDiagnostics
  genuineModelInference: true
  device: 'webgpu' | 'wasm' | 'unknown'
  resized: boolean
  elapsedMs: number
}

let sharedRemover: BgRemover | null = null
let preloadPromise: Promise<{ device: 'webgpu' | 'wasm' }> | null = null

/** Single shared remover — do not create per image. */
export function getSharedBgRemover(): BgRemover {
  if (!sharedRemover) {
    sharedRemover = createBgRemover({
      device: 'auto',
      dtype: 'fp16',
      useBrowserCache: true,
    })
  }
  return sharedRemover
}

/** Test / teardown helper. */
export function resetSharedBgRemoverForTests(): void {
  sharedRemover?.dispose()
  sharedRemover = null
  preloadPromise = null
}

/**
 * Download/warm the model early. Safe to call repeatedly.
 * Reports init progress via optional callback.
 */
export async function preloadBgRemoveModel(
  onProgress?: (event: BgRemoveSdkProgress) => void,
): Promise<{ device: 'webgpu' | 'wasm' }> {
  const remover = getSharedBgRemover()
  const unsub = remover.onInit((state) => {
    if (state.status === 'loading') {
      onProgress?.({
        kind: 'sdk-init',
        status: 'loading',
        message: state.message,
        ratio: state.ratio,
      })
    } else if (state.status === 'ready') {
      onProgress?.({
        kind: 'sdk-init',
        status: 'ready',
        device: state.device,
        ratio: 1,
      })
    } else if (state.status === 'error') {
      onProgress?.({
        kind: 'sdk-init',
        status: 'error',
        message: state.message,
      })
    } else {
      onProgress?.({ kind: 'sdk-init', status: state.status })
    }
  })

  try {
    if (!preloadPromise) {
      preloadPromise = remover.preload().catch((err) => {
        preloadPromise = null
        throw err
      })
    }
    return await preloadPromise
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to load the local background-removal model.'
    throw new Error(
      `Model init failed (${message}). Check network access to download weights (~88 MB fp16) once, then retry. Inference stays on-device.`,
    )
  } finally {
    unsub()
  }
}

async function decodeBlobToRgba(
  blob: Blob,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const imageData = await imageDataFromObjectUrl(url)
    return {
      rgba: imageData.data,
      width: imageData.width,
      height: imageData.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Run local SDK inference on an image Blob and convert the transparent PNG
 * alpha into a KEEP MaskPixelBuffer aligned to `sourceWidth`×`sourceHeight`.
 * Compositing should continue to use the original upload RGB.
 */
export async function segmentWithBgRemoveSdk(
  imageBlob: Blob,
  sourceWidth: number,
  sourceHeight: number,
  options: {
    onProgress?: (event: BgRemoveSdkProgress) => void
    /** Optional original pixels for confidence heuristics (not sent anywhere). */
    sourceImageData?: ImageData
  } = {},
): Promise<BgRemoveSdkResult> {
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('Invalid source image dimensions for SDK auto-mask.')
  }
  if (imageBlob.size === 0) {
    throw new Error('Empty image for SDK auto-mask.')
  }

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  const { device } = await preloadBgRemoveModel(options.onProgress)
  const remover = getSharedBgRemover()

  let processed
  try {
    processed = await remover.process(imageBlob, 'png', (p) => {
      options.onProgress?.({
        kind: 'sdk-process',
        stage: p.stage,
        ratio: p.ratio,
      })
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Local inference failed.'
    if (/memory|oom|out of memory/i.test(message)) {
      throw new Error(
        'Out of memory during local background removal. Try a smaller image or close other tabs.',
      )
    }
    if (/webgpu|wasm|worker|unsupported/i.test(message)) {
      throw new Error(
        `Browser cannot run local inference (${message}). Use a recent Chrome/Edge/Firefox/Safari with Web Workers.`,
      )
    }
    throw new Error(`Local background removal failed: ${message}`)
  }

  const decoded = await decodeBlobToRgba(processed.blob)
  // Alpha polarity: 255 KEEP / 0 BG / gray soft — never inverted or hard-thresholded.
  const { mask, resized } = maskFromTransparentRgba(
    decoded.rgba,
    decoded.width,
    decoded.height,
    sourceWidth,
    sourceHeight,
  )

  // Prefer original upload RGB for review; never invent garment colors from alpha.
  const sourceImageData =
    options.sourceImageData &&
    options.sourceImageData.width === mask.width &&
    options.sourceImageData.height === mask.height
      ? options.sourceImageData
      : undefined

  const review = reviewSdkMask(mask, sourceImageData, { resized })

  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  return {
    mask,
    methodUsed: BG_REMOVE_SDK_METHOD,
    provider: BG_REMOVE_SDK_PROVIDER,
    confidence: review.score,
    needsReview: review.needsReview,
    reviewReasons: review.reasons,
    findings: review.findings,
    diagnostics: review.diagnostics,
    genuineModelInference: true,
    device,
    resized,
    elapsedMs: Math.round(t1 - t0),
  }
}
