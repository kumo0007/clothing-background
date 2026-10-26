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
import {
  classifyBgRemoveFailure,
  classifyInitProgressStage,
  formatSdkProcessStage,
  noteBgRemoveDiagnostic,
} from './bgRemoveDiagnostics'
import {
  describeDevicePreference,
  describeWeightDtype,
  isWasmBackendOutOfMemoryFailure,
  isWasmModuleImportFailure,
  isWebGpuBackendInitFailure,
  resolvePreferredBgRemoveDevice,
  resolvePreferredBgRemoveDtype,
  yieldForWasmMemoryPressure,
  type BgRemoveDevicePreference,
  type BgRemoveWeightDtype,
} from './bgRemoveDevice'

export {
  getBgRemoveTimingSnapshot,
  formatInitProgressLine,
  classifyInitMessage,
  resetBgRemoveTimingForTests,
} from './bgRemoveTiming'

export {
  getBgRemoveDiagnosticSnapshot,
  formatSdkProcessStage,
  resetBgRemoveDiagnosticsForTests,
  classifyBgRemoveFailure,
} from './bgRemoveDiagnostics'

export {
  resolvePreferredBgRemoveDevice,
  resolvePreferredBgRemoveDtype,
  isWebGpuBackendInitFailure,
  isWasmBackendOutOfMemoryFailure,
  isWasmModuleImportFailure,
  isAppleMobileUserAgent,
  isSafariFamilyUserAgent,
  describeDevicePreference,
  describeWeightDtype,
  yieldForWasmMemoryPressure,
} from './bgRemoveDevice'
export type {
  BgRemoveDevicePreference,
  BgRemoveWeightDtype,
} from './bgRemoveDevice'

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
/** Device passed into the current shared remover (same RMBG-1.4 model). */
let sharedDevicePreference: BgRemoveDevicePreference | null = null
let sharedWeightDtype: BgRemoveWeightDtype | null = null

function buildRemoverOptions(
  device: BgRemoveDevicePreference,
  dtype: BgRemoveWeightDtype = resolvePreferredBgRemoveDtype(device),
) {
  const modelId = resolveBgRemoveModelId()
  return {
    device,
    // SDK public types list fp16|fp32; q8 is valid at runtime for transformers.js.
    dtype: dtype as 'fp16' | 'fp32',
    useBrowserCache: true,
    // Optional self-hosted / mirrored RMBG-1.4 weights only (see allowlist).
    ...(modelId ? { modelId } : {}),
  }
}

/** Single shared remover — do not create per image. */
export function getSharedBgRemover(
  devicePreference: BgRemoveDevicePreference = resolvePreferredBgRemoveDevice(),
  dtypePreference: BgRemoveWeightDtype = resolvePreferredBgRemoveDtype(
    devicePreference,
  ),
): BgRemover {
  if (!sharedRemover) {
    sharedDevicePreference = devicePreference
    sharedWeightDtype = dtypePreference
    noteBgRemoveDiagnostic({
      type: 'backend_select',
      device: devicePreference === 'auto' ? 'unknown' : devicePreference,
      detail: `${describeDevicePreference(devicePreference)}; ${describeWeightDtype(dtypePreference)}`.slice(
        0,
        160,
      ),
    })
    sharedRemover = createBgRemover(
      buildRemoverOptions(devicePreference, dtypePreference),
    )
  }
  return sharedRemover
}

/**
 * Dispose the shared worker and clear the preload latch.
 * Required after init/process timeouts: `withTimeout` rejects the app promise
 * but the SDK may still hold a hung job on its internal queue, blocking later
 * images until the worker is terminated.
 */
export function recoverSharedBgRemover(reason: string): void {
  noteBgRemoveDiagnostic({
    type: 'recover_worker',
    detail: reason.slice(0, 160),
    failureStage: classifyBgRemoveFailure(reason),
  })
  try {
    sharedRemover?.dispose()
  } catch {
    // ignore dispose races
  }
  sharedRemover = null
  preloadPromise = null
  sharedDevicePreference = null
  sharedWeightDtype = null
}

/** Test / teardown helper. */
export function resetSharedBgRemoverForTests(): void {
  recoverSharedBgRemover('test-reset')
}

/**
 * Download/warm the model early. Safe to call repeatedly.
 * Reports init progress via optional callback.
 * Timed out inits are failures — never treated as ready.
 */
export async function preloadBgRemoveModel(
  onProgress?: (event: BgRemoveSdkProgress) => void,
): Promise<{ device: 'webgpu' | 'wasm' }> {
  const attemptedDevice =
    sharedDevicePreference ?? resolvePreferredBgRemoveDevice()
  const attemptedDtype =
    sharedWeightDtype ?? resolvePreferredBgRemoveDtype(attemptedDevice)

  // Let Safari reclaim memory from prior workers / decoded frames before WASM grow.
  if (attemptedDevice === 'wasm' || attemptedDtype === 'q8') {
    await yieldForWasmMemoryPressure()
  }

  const remover = getSharedBgRemover(attemptedDevice, attemptedDtype)
  const unsub = remover.onInit((state) => {
    if (state.status === 'loading') {
      const stage = classifyInitProgressStage(state.message)
      noteBgRemoveInitProgress(state.message, state.ratio)
      noteBgRemoveDiagnostic({
        type: 'init_stage',
        detail: `${stage}:${(state.message ?? '').slice(0, 80)}`,
        device: attemptedDevice === 'auto' ? 'unknown' : attemptedDevice,
        failureStage:
          stage === 'download'
            ? 'download'
            : stage === 'runtime' || stage === 'session'
              ? 'session'
              : 'init',
      })
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

  noteBgRemoveDiagnostic({
    type: 'init_start',
    detail:
      `preload:${describeDevicePreference(attemptedDevice)};${describeWeightDtype(attemptedDtype)}`.slice(
        0,
        160,
      ),
    device: attemptedDevice === 'auto' ? 'unknown' : attemptedDevice,
  })

  const runPreload = async (instance: BgRemover) => {
    if (!preloadPromise) {
      preloadPromise = withTimeout(
        instance.preload(),
        BG_REMOVE_PRELOAD_TIMEOUT_MS,
        `Model download timed out after ${Math.round(BG_REMOVE_PRELOAD_TIMEOUT_MS / 1000)}s. Check network access for model weights, stay on Wi‑Fi, keep this Safari tab open, then tap Auto-mask again.`,
      ).catch((err) => {
        preloadPromise = null
        throw err
      })
    }
    return preloadPromise
  }

  try {
    const ready = await runPreload(remover)
    noteBgRemoveDiagnostic({
      type: 'init_ready',
      device: ready.device,
      detail: `preload-resolved:${sharedWeightDtype ?? attemptedDtype}`,
    })
    return ready
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Failed to load the local background-removal model.'
    noteBgRemoveDiagnostic({
      type: 'init_error',
      detail: message.slice(0, 160),
      failureStage: classifyBgRemoveFailure(message),
      device: attemptedDevice === 'auto' ? 'unknown' : attemptedDevice,
    })

    const retryWith = async (
      device: BgRemoveDevicePreference,
      dtype: BgRemoveWeightDtype,
      reason: string,
      progressMessage: string,
    ): Promise<{ device: 'webgpu' | 'wasm' }> => {
      noteBgRemoveDiagnostic({
        type: 'backend_fallback',
        device: device === 'auto' ? 'unknown' : device,
        detail: reason.slice(0, 120),
        failureStage: classifyBgRemoveFailure(message),
      })
      recoverSharedBgRemover(message)
      await yieldForWasmMemoryPressure()
      unsub()
      const next = getSharedBgRemover(device, dtype)
      const nextUnsub = next.onInit((state) => {
        if (state.status === 'loading') {
          const stage = classifyInitProgressStage(state.message)
          noteBgRemoveInitProgress(state.message, state.ratio)
          noteBgRemoveDiagnostic({
            type: 'init_stage',
            detail: `${stage}:${(state.message ?? '').slice(0, 80)}`,
            device: device === 'auto' ? 'unknown' : device,
          })
          onProgress?.({
            kind: 'sdk-init',
            status: 'loading',
            message: state.message ?? progressMessage,
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
        }
      })
      try {
        onProgress?.({
          kind: 'sdk-init',
          status: 'loading',
          message: progressMessage,
        })
        preloadPromise = null
        const ready = await runPreload(next)
        noteBgRemoveDiagnostic({
          type: 'init_ready',
          device: ready.device,
          detail: `preload-resolved-after:${reason}`.slice(0, 120),
        })
        return ready
      } finally {
        nextUnsub()
      }
    }

    // Same RMBG-1.4 model: WebGPU module import failed → WASM (+ mobile q8).
    if (isWebGpuBackendInitFailure(message) && attemptedDevice !== 'wasm') {
      try {
        return await retryWith(
          'wasm',
          resolvePreferredBgRemoveDtype('wasm'),
          'webgpu-init-failed-retry-wasm',
          'WebGPU unavailable — loading WASM backend (same RMBG-1.4)…',
        )
      } catch (retryErr) {
        const retryMessage =
          retryErr instanceof Error
            ? retryErr.message
            : 'Failed to load the local background-removal model on WASM.'
        noteBgRemoveDiagnostic({
          type: 'init_error',
          detail: retryMessage.slice(0, 160),
          failureStage: classifyBgRemoveFailure(retryMessage),
          device: 'wasm',
        })
        recoverSharedBgRemover(retryMessage)
        if (/timed out/i.test(retryMessage)) {
          throw new Error(retryMessage)
        }
        if (isWasmBackendOutOfMemoryFailure(retryMessage)) {
          throw new Error(
            `Model init failed (${retryMessage}). WASM ran out of memory while creating the on-device RMBG-1.4 session. Close other Safari tabs, keep this tab open, then Retry failed (one model instance only).`,
          )
        }
        throw new Error(
          `Model init failed (${retryMessage}). WASM backend could not start for RMBG-1.4. Check network for weights, keep this Safari tab open, then Retry failed. Inference stays on-device.`,
        )
      }
    }

    // fp16 WASM OOM → one retry with q8 weights of the same RMBG-1.4 repo.
    if (
      isWasmBackendOutOfMemoryFailure(message) &&
      attemptedDtype !== 'q8'
    ) {
      try {
        return await retryWith(
          'wasm',
          'q8',
          'wasm-fp16-oom-retry-q8',
          'WASM memory limit hit — reloading quantized RMBG-1.4 (q8)…',
        )
      } catch (retryErr) {
        const retryMessage =
          retryErr instanceof Error
            ? retryErr.message
            : 'Failed to load quantized RMBG-1.4 on WASM.'
        noteBgRemoveDiagnostic({
          type: 'init_error',
          detail: retryMessage.slice(0, 160),
          failureStage: classifyBgRemoveFailure(retryMessage),
          device: 'wasm',
        })
        recoverSharedBgRemover(retryMessage)
        if (/timed out/i.test(retryMessage)) {
          throw new Error(retryMessage)
        }
        throw new Error(
          `Model init failed (${retryMessage}). On-device WASM could not allocate for RMBG-1.4 even with quantized weights. Close other tabs, retry with fewer photos first, keep this Safari tab open. Inference stays on-device.`,
        )
      }
    }

    // Terminate hung init worker so Retry is not stuck behind it.
    recoverSharedBgRemover(message)
    if (/timed out/i.test(message)) {
      throw new Error(message)
    }
    if (isWasmBackendOutOfMemoryFailure(message)) {
      throw new Error(
        `Model init failed (${message}). Out of memory during WASM session init for RMBG-1.4 (not during image inference). Close other Safari tabs, then Retry failed.`,
      )
    }
    if (isWasmModuleImportFailure(message)) {
      throw new Error(
        `Model init failed (${message}). Safari could not load the on-device WASM runtime module (ORT .mjs). Hard-refresh this tab on Wi‑Fi, then Retry failed. Inference stays on-device.`,
      )
    }
    if (isWebGpuBackendInitFailure(message)) {
      throw new Error(
        `Model init failed (${message}). This browser could not start the WebGPU runtime module; try again to use the WASM backend for the same RMBG-1.4 model, keep this tab open, and stay on Wi‑Fi for the weights.`,
      )
    }
    throw new Error(
      `Model init failed (${message}). Check network access to download weights once, then retry. Inference stays on-device.`,
    )
  } finally {
    // Retry paths already unsubscribed the first listener.
    try {
      unsub()
    } catch {
      // ignore double-unsub
    }
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

  noteBgRemoveDiagnostic({
    type: 'process_start',
    device,
    width: prepared.width,
    height: prepared.height,
    detail: prepared.scaled ? 'downscaled-input' : 'full-res-input',
  })

  let processed
  const processStartedAt =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  /** Keep UI alive during long WASM runs (iOS may look frozen without ticks). */
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        processStartedAt) /
        1000,
    )
    options.onProgress?.({
      kind: 'sdk-process',
      stage: `Running on-device inference… (${elapsedSec}s, ${device})`,
    })
  }, 5_000)

  try {
    processed = await withTimeout(
      remover.process(prepared.blob, 'png', (p) => {
        const stage = formatSdkProcessStage(p.stage)
        noteBgRemoveDiagnostic({
          type: 'process_progress',
          detail: stage.slice(0, 80),
          device,
        })
        options.onProgress?.({
          kind: 'sdk-process',
          stage,
          ratio: p.ratio,
        })
      }),
      BG_REMOVE_PROCESS_TIMEOUT_MS,
      `Local inference timed out after ${Math.round(BG_REMOVE_PROCESS_TIMEOUT_MS / 1000)}s (${device}). Keep this Safari tab open, try a smaller photo, then Retry failed.`,
    )
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Local inference failed.'
    noteBgRemoveDiagnostic({
      type: 'process_error',
      detail: message.slice(0, 160),
      device,
      width: prepared.width,
      height: prepared.height,
      failureStage: classifyBgRemoveFailure(message),
    })
    // Critical: terminate hung worker so later queue items / Retry are not blocked.
    recoverSharedBgRemover(message)
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
  } finally {
    clearInterval(heartbeat)
  }

  noteBgRemoveDiagnostic({
    type: 'process_done',
    device,
    width: prepared.width,
    height: prepared.height,
    elapsedMs: Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        processStartedAt,
    ),
  })

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
