/**
 * Actionable BiRefNet init / inference failure copy for the Batch UI.
 * Does not mention RMBG or other models — BiRefNet is the sole auto-mask backend.
 */
import {
  isWasmBackendOutOfMemoryFailure,
  isWasmModuleImportFailure,
  isWebGpuBackendInitFailure,
  isWeightDownloadNetworkFailure,
} from '../bgRemoveDevice'
import { BIREFNET_ONNX_FP16_BYTES } from './constants'

const WEIGHT_MB = Math.round(BIREFNET_ONNX_FP16_BYTES / (1024 * 1024))

/** Map opaque network / WASM / OOM errors to BiRefNet-accurate UI copy. */
export function formatBirefNetInitFailureMessage(raw: string): string {
  const message = raw.trim() || 'Failed to load BiRefNet.'
  if (isWeightDownloadNetworkFailure(message)) {
    return (
      `BiRefNet weight download failed (${/NetworkError/i.test(message) ? 'Firefox network fetch' : 'Safari: Load failed'}). ` +
      `Weights should load from this site (/models/studioludens/birefnet-lite-512/… ~${WEIGHT_MB}MB); stay on Wi‑Fi, hard-refresh, then Retry failed. ` +
      `Inference stays on-device.`
    )
  }
  if (isWasmModuleImportFailure(message)) {
    return (
      `BiRefNet init failed (${message}). Could not load the on-device WASM runtime module. ` +
      `Hard-refresh on Wi‑Fi, then Retry failed. Inference stays on-device.`
    )
  }
  if (isWasmBackendOutOfMemoryFailure(message)) {
    return (
      `BiRefNet init failed (${message}). Out of memory during WASM session init. ` +
      `Close other tabs and apps, hard-refresh this page on Wi‑Fi, then Retry failed. ` +
      `If it still fails, try 1–2 photos at a time.`
    )
  }
  if (isWebGpuBackendInitFailure(message)) {
    return (
      `BiRefNet init failed (${message}). WebGPU runtime unavailable; production uses WASM for the same BiRefNet weights. ` +
      `Keep this tab open on Wi‑Fi, then Retry failed.`
    )
  }
  if (/timed out/i.test(message)) {
    return message
  }
  if (/BiRefNet|Model init failed/i.test(message)) {
    return message
  }
  return (
    `BiRefNet failed (${message}). Check network access to download weights once, then retry. ` +
    `Inference stays on-device.`
  )
}

export { isWeightDownloadNetworkFailure }
