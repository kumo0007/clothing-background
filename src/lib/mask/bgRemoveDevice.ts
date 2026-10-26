/**
 * Choose ONNX Runtime execution device / weight dtype for bg-remove-sdk without
 * changing the RMBG-1.4 model id.
 *
 * Safari on iOS often advertises WebGPU (`navigator.gpu`) so the SDK's
 * `device: 'auto'` path selects WebGPU, then ORT fails while dynamically
 * importing its WebGPU/JSEP module inside the blob worker:
 *   "no available backend found. ERR: [webgpu] TypeError: Importing a module script failed."
 * Prefer WASM up front on affected UAs.
 *
 * A follow-on failure on WASM:
 *   "no available backend found. ERR: [wasm] RangeError: Out of memory"
 * occurs during ORT WASM backend / session bring-up when the SDK forces
 * `dtype: 'fp16'` (~88 MB weights + heap). transformers.js maps WASM → **q8**
 * by default; use that quantized artifact of the same `briaai/RMBG-1.4` repo
 * on Apple mobile WASM so init fits Safari’s contiguous allocation limits.
 */

export type BgRemoveDevicePreference = 'auto' | 'webgpu' | 'wasm'

/** Runtime dtype forwarded to the SDK worker (SDK TS types only list fp16/fp32). */
export type BgRemoveWeightDtype = 'fp16' | 'fp32' | 'q8'

/** True for iPhone / iPad / iPod (including iPadOS desktop-UA with touch). */
export function isAppleMobileUserAgent(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  if (/iPhone|iPod/i.test(userAgent)) return true
  if (/iPad/i.test(userAgent)) return true
  // iPadOS 13+ may report as Macintosh.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return true
  return false
}

/**
 * Safari (including iOS Safari / CriOS-excluded). Chrome/Firefox/Edge on iOS
 * use different tokens (CriOS, FxiOS, EdgiOS).
 */
export function isSafariFamilyUserAgent(userAgent: string): boolean {
  if (!/Safari/i.test(userAgent)) return false
  if (/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(userAgent)) return false
  return true
}

/**
 * Prefer WASM for the same RMBG-1.4 weights when WebGPU module import is known
 * to fail in blob workers (Apple mobile Safari family).
 */
export function resolvePreferredBgRemoveDevice(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined'
    ? navigator.maxTouchPoints ?? 0
    : 0,
): BgRemoveDevicePreference {
  if (
    isAppleMobileUserAgent(userAgent, maxTouchPoints) &&
    (isSafariFamilyUserAgent(userAgent) ||
      /CriOS|FxiOS|EdgiOS/i.test(userAgent))
  ) {
    // All iOS browsers use WebKit; WebGPU/ORT JSEP import fails the same way.
    return 'wasm'
  }
  return 'auto'
}

/** Detect ORT/transformers WebGPU-only backend init failures. */
export function isWebGpuBackendInitFailure(message: string): boolean {
  const m = message.trim()
  if (!m) return false
  if (/Importing a module script failed/i.test(m) && /webgpu/i.test(m)) {
    return true
  }
  if (
    /no available backend found/i.test(m) &&
    /\[webgpu\]/i.test(m) &&
    !/\[wasm\]/i.test(m)
  ) {
    return true
  }
  return false
}

/**
 * ORT WASM failed to dynamically import its runtime `.mjs` (often CSP
 * script-src blocking cdn.jsdelivr.net / blob: inside the worker).
 */
export function isWasmModuleImportFailure(message: string): boolean {
  const m = message.trim()
  if (!m) return false
  if (!/Importing a module script failed/i.test(m)) return false
  if (/\[wasm\]/i.test(m)) return true
  if (/no available backend found/i.test(m) && /wasm/i.test(m)) return true
  return false
}

/**
 * ORT WASM backend init OOM (not inference-time tensor OOM).
 * Message shape from client: `[wasm] RangeError: Out of memory`.
 */
export function isWasmBackendOutOfMemoryFailure(message: string): boolean {
  const m = message.trim()
  if (!m) return false
  if (!/Out of memory|OOM/i.test(m)) return false
  if (/\[wasm\]/i.test(m)) return true
  if (/no available backend found/i.test(m) && /wasm/i.test(m)) return true
  return false
}

/**
 * Weight dtype for the same `briaai/RMBG-1.4` repo.
 * Apple-mobile WASM uses q8 (transformers.js default for wasm) to avoid the
 * fp16 session allocation that triggers Safari `RangeError: Out of memory`.
 */
export function resolvePreferredBgRemoveDtype(
  device: BgRemoveDevicePreference,
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined'
    ? navigator.maxTouchPoints ?? 0
    : 0,
): BgRemoveWeightDtype {
  const appleMobile = isAppleMobileUserAgent(userAgent, maxTouchPoints)
  if (appleMobile && (device === 'wasm' || device === 'auto')) {
    return 'q8'
  }
  return 'fp16'
}

/** Yield so Safari can reclaim memory after worker dispose / before WASM init. */
export async function yieldForWasmMemoryPressure(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 16)
    }
  })
}

export function describeDevicePreference(
  preference: BgRemoveDevicePreference,
): string {
  switch (preference) {
    case 'wasm':
      return 'wasm (preferred for this browser)'
    case 'webgpu':
      return 'webgpu'
    case 'auto':
      return 'auto (WebGPU when available, else WASM)'
    default: {
      const _exhaustive: never = preference
      return _exhaustive
    }
  }
}

export function describeWeightDtype(dtype: BgRemoveWeightDtype): string {
  switch (dtype) {
    case 'q8':
      return 'q8 (RMBG-1.4 quantized, WASM-safe)'
    case 'fp16':
      return 'fp16'
    case 'fp32':
      return 'fp32'
    default: {
      const _exhaustive: never = dtype
      return _exhaustive
    }
  }
}
