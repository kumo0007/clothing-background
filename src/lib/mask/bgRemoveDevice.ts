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

/** Desktop Firefox or Firefox on iOS (FxiOS). */
export function isFirefoxUserAgent(userAgent: string): boolean {
  return /Firefox\//i.test(userAgent) || /FxiOS\//i.test(userAgent)
}

/**
 * Firefox + transformers.js workers choke on large Cache API / HTTP-cache
 * reads of ~44MB+ ONNX (NetworkError / hung progress). Apple mobile WebKit
 * hits the same class of failure on first-run weight download. Prefer no
 * browser cache on those UAs.
 * @see https://github.com/xenova/transformers.js/issues/373
 */
export function shouldDisableBgRemoveBrowserCache(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined'
    ? navigator.maxTouchPoints ?? 0
    : 0,
): boolean {
  if (isFirefoxUserAgent(userAgent)) return true
  if (isAppleMobileUserAgent(userAgent, maxTouchPoints)) return true
  return false
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
 * Safari/WebKit generic network failure — often a CSP `connect-src` block on
 * Hugging Face CDN redirects (`us.aws.cdn.hf.co`), not a missing Wi‑Fi signal.
 */
export function isSafariNetworkLoadFailure(message: string): boolean {
  const m = message.trim()
  if (!m) return false
  if (/^Load failed$/i.test(m)) return true
  if (/TypeError:\s*Load failed/i.test(m)) return true
  if (/Failed to fetch/i.test(m) && /safari|iphone|ipad|webkit/i.test(m)) {
    return true
  }
  // Bare WebKit fetch rejection text without stack.
  if (/^TypeError: Load failed$/i.test(m)) return true
  return false
}

/**
 * Firefox (and some WebKit) fetch failures for model weights / worker assets.
 * Exact Firefox copy: "NetworkError when attempting to fetch resource."
 */
export function isWeightDownloadNetworkFailure(message: string): boolean {
  if (isSafariNetworkLoadFailure(message)) return true
  const m = message.trim()
  if (!m) return false
  if (/NetworkError when attempting to fetch resource/i.test(m)) return true
  if (/^NetworkError$/i.test(m)) return true
  if (/TypeError:\s*NetworkError/i.test(m)) return true
  if (/^Failed to fetch$/i.test(m)) return true
  if (/TypeError:\s*Failed to fetch/i.test(m)) return true
  return false
}

/** Map opaque Safari/WebKit errors to actionable, privacy-safe copy. */
export function formatBgRemoveInitFailureMessage(raw: string): string {
  const message = raw.trim() || 'Failed to load the local background-removal model.'
  if (isWeightDownloadNetworkFailure(message)) {
    return (
      `Model weight download failed (${/NetworkError/i.test(message) ? 'Firefox network fetch' : 'Safari: Load failed'}). ` +
      `Weights should load from this site (/models/… ~44MB); stay on Wi‑Fi, hard-refresh, then Retry failed. ` +
      `Inference stays on-device.`
    )
  }
  if (isWasmModuleImportFailure(message)) {
    return (
      `Model init failed (${message}). Safari could not load the on-device WASM runtime module. ` +
      `Hard-refresh on Wi‑Fi, then Retry failed. Inference stays on-device.`
    )
  }
  if (isWasmBackendOutOfMemoryFailure(message)) {
    return (
      `Model init failed (${message}). Out of memory during WASM session init for RMBG-1.4. ` +
      `Close other Safari tabs and apps, hard-refresh this page on Wi‑Fi, then Retry failed. ` +
      `If it still fails, try 1–2 photos at a time.`
    )
  }
  if (isWebGpuBackendInitFailure(message)) {
    return (
      `Model init failed (${message}). WebGPU runtime unavailable; use WASM for the same RMBG-1.4 model. ` +
      `Keep this tab open on Wi‑Fi, then Retry failed.`
    )
  }
  if (/timed out/i.test(message)) {
    return message
  }
  if (/Model init failed/i.test(message)) {
    return message
  }
  return (
    `Model init failed (${message}). Check network access to download weights once, then retry. ` +
    `Inference stays on-device.`
  )
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
  // Same-origin mirror vendors quantized ONNX; WASM prefers q8 everywhere.
  if (device === 'wasm') return 'q8'
  return 'fp16'
}

export type YieldForWasmMemoryOptions = {
  /**
   * Extra GC windows for Safari after a failed WASM session (fragmented heap).
   * Prefer this before a cold q8 retry.
   */
  intensive?: boolean
}

/** Yield so Safari can reclaim memory after worker dispose / before WASM init. */
export async function yieldForWasmMemoryPressure(
  options?: YieldForWasmMemoryOptions,
): Promise<void> {
  const intensive = options?.intensive === true
  const rounds = intensive ? 5 : 1
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intensive ? 40 * (i + 1) : 0)
    })
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
      } else {
        setTimeout(resolve, 16)
      }
    })
  }
  // Optional engine GC (Chrome --js-flags=--expose-gc; no-op elsewhere).
  const maybeGc = (
    globalThis as typeof globalThis & { gc?: () => void }
  ).gc
  if (intensive && typeof maybeGc === 'function') {
    try {
      maybeGc()
    } catch {
      // ignore
    }
  }
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
