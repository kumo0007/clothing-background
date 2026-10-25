/**
 * Browser-local background removal via `bg-remove-sdk` (RMBG-1.4 + transformers.js).
 *
 * - Inference runs in a Web Worker (WebGPU when available, WASM fallback).
 * - One shared `BgRemover` instance for the page (model loaded once).
 * - Images never leave the device; only model weights download from HF (or a mirror).
 *
 * Commercial note: the SDK is MIT, but the default model `briaai/RMBG-1.4` is
 * source-available under BRIA’s non-commercial / evaluation terms (`bria-rmbg-1.4`).
 * Local inference does not waive licensing; commercial use needs a BRIA agreement.
 */
import { createBgRemover, type BgRemover, type InitState } from 'bg-remove-sdk'
import type { MaskPixelBuffer } from '../../types/mask'
import { maskFromTransparentRgba } from './apiTransparentPngMask'
import { reviewSdkMask } from './sdkMaskReview'
import { imageDataFromObjectUrl } from '../image/imageDataFromUrl'
import { downscaleBlobForInference } from '../image/downscaleBlobForInference'
import { withTimeout } from '../async/withTimeout'
import {
  noteBgRemoveInitProgress,
  noteBgRemoveProcessMs,
  noteBgRemoveReady,
} from './bgRemoveTiming'

export {
  getBgRemoveTimingSnapshot,
  formatInitProgressLine,
  classifyInitMessage,
  resetBgRemoveTimingForTests,
} from './bgRemoveTiming'

export const BG_REMOVE_SDK_METHOD = 'bg-remove-sdk-rmbg1.4'
export const BG_REMOVE_SDK_PROVIDER = 'bg-remove-sdk'

/**
 * Upstream Hugging Face id used when `VITE_BG_REMOVE_MODEL_ID` is unset.
 * The SDK also defaults here; we document it so overrides stay RMBG-1.4-only.
 */
export const DEFAULT_BG_REMOVE_HF_MODEL_ID = 'briaai/RMBG-1.4'

/** First-download of ~88 MB fp16 weights on mobile networks can be slow. */
export const BG_REMOVE_PRELOAD_TIMEOUT_MS = 180_000
/** Per-image worker inference (WASM on phones is the slow path). */
export const BG_REMOVE_PROCESS_TIMEOUT_MS = 120_000

/**
 * Allow only RMBG-1.4 weight locations (default HF id or mirrors that still
 * name RMBG-1.4). Rejects other model families so an env typo cannot silently
 * switch segmentation algorithms.
 */
export function isAllowedBgRemoveModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (/u2-?net|birefnet|modnet|\bisnet\b|sam-|yolov?\d/i.test(id)) {
    return false
  }
  if (id.toLowerCase() === DEFAULT_BG_REMOVE_HF_MODEL_ID.toLowerCase()) {
    return true
  }
  // Mirror / org fork paths must still identify RMBG-1.4 (not 2.0, etc.).
  return /RMBG-1\.4/i.test(id)
}

let warnedInvalidModelId = false

/** Test helper — reset one-shot invalid-env warning. */
export function resetBgRemoveModelIdWarningForTests(): void {
  warnedInvalidModelId = false
}

function warnInvalidModelIdOnce(): void {
  if (warnedInvalidModelId) return
  warnedInvalidModelId = true
  // Do not echo the env value — mirrors may embed tokens in URLs.
  console.warn(
    `[bgRemoveSdk] Ignoring VITE_BG_REMOVE_MODEL_ID: not an allowed RMBG-1.4 location. Using SDK default ${DEFAULT_BG_REMOVE_HF_MODEL_ID}. Other model families are rejected.`,
  )
}

/**
 * Resolve optional `VITE_BG_REMOVE_MODEL_ID`. Empty/unset → `undefined`
 * (SDK loads {@link DEFAULT_BG_REMOVE_HF_MODEL_ID}). Disallowed values are
 * ignored the same way so production cannot silently switch models.
 */
export function resolveBgRemoveModelId(
  envValue?: string | null,
): string | undefined {
  let raw: string | undefined
  if (envValue !== undefined && envValue !== null) {
    raw = String(envValue).trim()
  } else {
    try {
      const fromEnv = import.meta.env?.VITE_BG_REMOVE_MODEL_ID
      if (typeof fromEnv === 'string') raw = fromEnv.trim()
    } catch {
      raw = undefined
    }
  }
  if (!raw) return undefined
  if (!isAllowedBgRemoveModelId(raw)) {
    warnInvalidModelIdOnce()
    return undefined
  }
  // Canonicalize the well-known HF id (whitespace/case variants).
  if (raw.toLowerCase() === DEFAULT_BG_REMOVE_HF_MODEL_ID.toLowerCase()) {
    return DEFAULT_BG_REMOVE_HF_MODEL_ID
  }
  return raw
}

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
    const modelId = resolveBgRemoveModelId()
    sharedRemover = createBgRemover({
      device: 'auto',
      dtype: 'fp16',
      useBrowserCache: true,
      // Optional self-hosted / mirrored RMBG-1.4 weights only (see allowlist).
      ...(modelId ? { modelId } : {}),
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
 * Timed out inits are failures — never treated as ready.
 */
export async function preloadBgRemoveModel(
  onProgress?: (event: BgRemoveSdkProgress) => void,
): Promise<{ device: 'webgpu' | 'wasm' }> {
  const remover = getSharedBgRemover()
  const unsub = remover.onInit((state) => {
    if (state.status === 'loading') {
      noteBgRemoveInitProgress(state.message, state.ratio)
      onProgress?.({
        kind: 'sdk-init',
        status: 'loading',
        message: state.message,
        ratio: state.ratio,
      })
    } else if (state.status === 'ready') {
      noteBgRemoveReady()
      onProgress?.({
        kind: 'sdk-init',
        status: 'ready',
        device: state.device,
        ratio: 1,
      })
    } else if (state.status === 'error') {
      noteBgRemoveInitProgress(state.message)
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
      preloadPromise = withTimeout(
        remover.preload(),
        BG_REMOVE_PRELOAD_TIMEOUT_MS,
        `Model download timed out after ${Math.round(BG_REMOVE_PRELOAD_TIMEOUT_MS / 1000)}s. Check network access for the ~88 MB weights, stay on Wi‑Fi, then tap Auto-mask again.`,
      ).catch((err) => {
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
    if (/timed out/i.test(message)) {
      throw new Error(message)
    }
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

  // Cap long-edge before worker input — SDK still maps alpha back to source size.
  const prepared = await downscaleBlobForInference(
    imageBlob,
    sourceWidth,
    sourceHeight,
  )

  let processed
  try {
    processed = await withTimeout(
      remover.process(prepared.blob, 'png', (p) => {
        options.onProgress?.({
          kind: 'sdk-process',
          stage: p.stage,
          ratio: p.ratio,
        })
      }),
      BG_REMOVE_PROCESS_TIMEOUT_MS,
      `Local inference timed out after ${Math.round(BG_REMOVE_PROCESS_TIMEOUT_MS / 1000)}s. Try a smaller photo or Retry failed.`,
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Local inference failed.'
    if (/timed out/i.test(message)) {
      throw new Error(message)
    }
    if (/memory|oom|out of memory/i.test(message)) {
      throw new Error(
        'Out of memory during local background removal. Try a smaller image or close other tabs.',
      )
    }
    if (/webgpu|wasm|worker|unsupported/i.test(message)) {
      throw new Error(
        `Browser cannot run local inference (${message}). Use a recent Chrome/Edge/Firefox/Safari with Web Workers. On iPhone, update iOS and keep this tab open while the model loads.`,
      )
    }
    throw new Error(`Local background removal failed: ${message}`)
  }

  const decoded = await decodeBlobToRgba(processed.blob)
  // Alpha polarity: 255 KEEP / 0 BG / gray soft — never inverted or hard-thresholded.
  // Always target original upload dimensions (prepared may be downscaled).
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

  const review = reviewSdkMask(mask, sourceImageData, {
    resized: resized || prepared.scaled,
  })

  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsedMs = Math.round(t1 - t0)
  noteBgRemoveProcessMs(elapsedMs)

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
    resized: resized || prepared.scaled,
    elapsedMs,
  }
}
