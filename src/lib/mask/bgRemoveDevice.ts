/**
 * Choose ONNX Runtime execution device for bg-remove-sdk without changing the
 * RMBG-1.4 model. Safari on iOS often advertises WebGPU (`navigator.gpu`) so
 * the SDK's `device: 'auto'` path selects WebGPU, then ORT fails while
 * dynamically importing its WebGPU/JSEP module inside the blob worker:
 *   "no available backend found. ERR: [webgpu] TypeError: Importing a module script failed."
 * That path does not fall back to WASM. Prefer WASM up front on affected UAs,
 * and allow a one-shot WASM retry after a WebGPU-only backend init failure.
 */

export type BgRemoveDevicePreference = 'auto' | 'webgpu' | 'wasm'

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
