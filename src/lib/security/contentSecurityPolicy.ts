/**
 * Canonical Content-Security-Policy for the static Vite SPA on Vercel.
 *
 * Goals:
 * - Allow same-origin Vite entry modules, CSS, and workers (`'self'`).
 * - Allow WebAssembly compilation for on-device RMBG (`'wasm-unsafe-eval'` —
 *   NOT `'unsafe-eval'`).
 * - Allow blob: workers used by bg-remove-sdk’s inline worker bootstrap.
 * - Allow ORT WASM to dynamically `import()` its JSEP `.mjs` from the
 *   transformers.js CDN (`script-src` https://cdn.jsdelivr.net) and from
 *   blob: URLs inside the worker. `connect-src` alone is not enough — Safari
 *   reports `TypeError: Importing a module script failed` when script-src
 *   omits that host (seen on iPhone as `[wasm] Importing a module script failed`).
 * - Allow Hugging Face / transformers CDN fetches for RMBG-1.4 weights via
 *   connect-src (images never leave the device). HF `resolve/` redirects to
 *   multi-label hosts such as `us.aws.cdn.hf.co`; Safari treats `*.hf.co` as
 *   a single label only, so those redirects become `TypeError: Load failed`
 *   unless `*.cdn.hf.co` / `*.aws.cdn.hf.co` (and xet bridges) are listed.
 * - Keep object-src / frame-ancestors locked down.
 *
 * Must never ship `script-src 'none'` or `default-src 'none'` without an
 * overriding script-src that permits `'self'`.
 */

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'wasm-unsafe-eval'",
    'blob:',
    'https://cdn.jsdelivr.net',
  ],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://huggingface.co',
    'https://*.huggingface.co',
    'https://hf.co',
    'https://*.hf.co',
    // HF Xet / AWS CDN redirects. Safari only expands `*` one DNS label, so
    // list both wildcards and the exact regional hosts seen in resolve/.
    'https://*.cdn.hf.co',
    'https://*.aws.cdn.hf.co',
    'https://us.aws.cdn.hf.co',
    'https://eu.aws.cdn.hf.co',
    'https://*.xethub.hf.co',
    'https://cas-bridge.xethub.hf.co',
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
  if (!/script-src[^;]*cdn\.jsdelivr\.net/i.test(policy)) {
    throw new Error(
      `CSP must allow script-src https://cdn.jsdelivr.net for ORT WASM .mjs imports: ${policy}`,
    )
  }
  if (!/script-src[^;]*blob:/i.test(policy)) {
    throw new Error(
      `CSP must allow script-src blob: for bg-remove-sdk worker module imports: ${policy}`,
    )
  }
  if (!/connect-src[^;]*cdn\.hf\.co/i.test(policy)) {
    throw new Error(
      `CSP must allow connect-src *.cdn.hf.co for Hugging Face weight redirects: ${policy}`,
    )
  }
  if (!/connect-src[^;]*aws\.cdn\.hf\.co/i.test(policy)) {
    throw new Error(
      `CSP must allow connect-src *.aws.cdn.hf.co for Safari HF CDN redirects: ${policy}`,
    )
  }
  if (!/connect-src[^;]*us\.aws\.cdn\.hf\.co/i.test(policy)) {
    throw new Error(
      `CSP must allow connect-src https://us.aws.cdn.hf.co (exact HF Xet host): ${policy}`,
    )
  }
}
