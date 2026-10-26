/**
 * Lightweight startup capability checks (not WebGPU/ONNX — those load later).
 * Returns actionable messages; does not throw.
 */

export type BootCompatResult = {
  ok: boolean
  warnings: string[]
}

export function checkBootCompat(
  g: Pick<typeof globalThis, 'document' | 'navigator'> & {
    Worker?: typeof Worker
    OffscreenCanvas?: typeof OffscreenCanvas
  } = globalThis,
): BootCompatResult {
  const warnings: string[] = []

  if (typeof g.document?.getElementById !== 'function') {
    return { ok: false, warnings: ['DOM is unavailable in this environment.'] }
  }

  if (typeof g.Worker !== 'function') {
    warnings.push(
      'Web Workers are unavailable. Auto-mask (on-device RMBG) will not run; upload/edit/export may still work.',
    )
  }

  // OffscreenCanvas is required by bg-remove-sdk workers; absence should not blank the UI.
  if (typeof g.OffscreenCanvas !== 'function') {
    warnings.push(
      'OffscreenCanvas is unavailable. Auto-mask may fail in this browser; try a current Firefox, Chrome, Edge, or Safari.',
    )
  }

  return { ok: true, warnings }
}

/** Sanitized one-line summary for UI banners (no UA dump). */
export function formatBootCompatBanner(warnings: string[]): string | null {
  if (warnings.length === 0) return null
  return warnings[0] ?? null
}
