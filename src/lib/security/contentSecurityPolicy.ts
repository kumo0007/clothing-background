/**
 * Canonical Content-Security-Policy for the static Vite SPA on Vercel.
 *
 * Goals:
 * - Allow same-origin Vite entry modules, CSS, and workers (`'self'`).
 * - Allow WebAssembly compilation for on-device RMBG (`'wasm-unsafe-eval'` —
 *   NOT `'unsafe-eval'`).
 * - Allow blob: workers used by bg-remove-sdk’s inline worker bootstrap.
 * - Allow Hugging Face / transformers CDN fetches for RMBG-1.4 weights only
 *   via connect-src (images never leave the device).
 * - Keep object-src / frame-ancestors locked down.
 *
 * Must never ship `script-src 'none'` or `default-src 'none'` without an
 * overriding script-src that permits `'self'`.
 */

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://huggingface.co',
    'https://*.huggingface.co',
    'https://*.hf.co',
    'https://cdn.jsdelivr.net',
  ],
  'worker-src': ["'self'", 'blob:'],
  'child-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
}

export function buildContentSecurityPolicy(
  directives: Readonly<Record<string, readonly string[]>> = CSP_DIRECTIVES,
): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** True when a policy string would block all scripts (the Firefox blank-page failure mode). */
export function policyBlocksAllScripts(policy: string): boolean {
  const normalized = policy.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return false

  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]+)/i.exec(normalized)
  if (scriptSrc) {
    const value = scriptSrc[1]!.trim()
    return value === "'none'" || value === 'none'
  }

  const defaultSrc = /(?:^|;)\s*default-src\s+([^;]+)/i.exec(normalized)
  if (defaultSrc) {
    const value = defaultSrc[1]!.trim()
    // default-src 'none' without script-src falls back and blocks scripts.
    return value === "'none'" || value === 'none'
  }

  return false
}

export function assertAppCspAllowsBootstrap(policy: string): void {
  if (policyBlocksAllScripts(policy)) {
    throw new Error(
      `CSP would block the Vite entry module (script-src/default-src 'none'): ${policy}`,
    )
  }
  if (!/script-src[^;]*'self'/i.test(policy)) {
    throw new Error(`CSP must include script-src 'self': ${policy}`)
  }
  if (/script-src[^;]*\*/i.test(policy)) {
    throw new Error(`CSP must not use script-src *: ${policy}`)
  }
  if (/script-src[^;]*'unsafe-eval'/i.test(policy)) {
    throw new Error(`CSP must not use 'unsafe-eval' (use wasm-unsafe-eval only): ${policy}`)
  }
  if (!/script-src[^;]*'wasm-unsafe-eval'/i.test(policy)) {
    throw new Error(`CSP must allow 'wasm-unsafe-eval' for ONNX WASM: ${policy}`)
  }
}
