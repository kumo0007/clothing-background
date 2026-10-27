/**
 * Bounded Safari / batch diagnostics for investigating tab resets.
 * Persists a small summary in sessionStorage (survives soft reloads; cleared by
 * Safari when the WebContent process is hard-killed — absence after a reset is
 * itself evidence of a process kill vs an in-app state wipe).
 *
 * Never logs image pixels, filenames with PII beyond short ids, or credentials.
 */

export type SafariDiagEventKind =
  | 'app_mount'
  | 'app_unmount'
  | 'batch_start'
  | 'batch_end'
  | 'model_init_start'
  | 'model_init_end'
  | 'image_queue'
  | 'image_running'
  | 'image_success'
  | 'image_failure'
  | 'queue_cancel'
  | 'state_reset'
  | 'lifecycle'
  | 'error'
  | 'memory_estimate'

export type SafariDiagEvent = {
  t: number
  kind: SafariDiagEventKind
  runId?: string
  message?: string
  detail?: Record<string, string | number | boolean | null | undefined>
}

const STORAGE_KEY = 'garment.safariBatchDiag.v1'
const INTERRUPT_KEY = 'garment.safariBatchInterrupt.v1'
const MAX_EVENTS = 80

let runId: string | null = null
let events: SafariDiagEvent[] = []
let lifecycleAttached = false

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function wallMs(): number {
  return Date.now()
}

function persist(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const payload = {
      runId,
      wall: wallMs(),
      events: events.slice(-MAX_EVENTS),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota / private mode — ignore.
  }
}

export function getSafariBatchRunId(): string | null {
  return runId
}

export function startSafariBatchRun(label = 'batch'): string {
  runId = `${label}-${wallMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  events = []
  logSafariDiag('batch_start', 'run started', { runId })
  return runId
}

export function endSafariBatchRun(ok: boolean, detail?: SafariDiagEvent['detail']): void {
  logSafariDiag('batch_end', ok ? 'run finished ok' : 'run finished with errors', {
    runId: runId ?? undefined,
    ok,
    ...detail,
  })
  clearSafariBatchInterrupt()
}

export function logSafariDiag(
  kind: SafariDiagEventKind,
  message?: string,
  detail?: SafariDiagEvent['detail'],
): void {
  const event: SafariDiagEvent = {
    t: Math.round(nowMs()),
    kind,
    runId: runId ?? undefined,
    message,
    detail,
  }
  events.push(event)
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS)
  }
  persist()
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[safariBatchDiag]', kind, message ?? '', detail ?? '')
  }
}

/** Estimate RGBA + mask bytes for one source (not measured Safari heap). */
export function estimateImageBuffersBytes(
  width: number,
  height: number,
): {
  rgbaBytes: number
  maskBytes: number
  tensor512Bytes: number
} {
  const pixels = Math.max(0, width) * Math.max(0, height)
  return {
    rgbaBytes: pixels * 4,
    maskBytes: pixels,
    tensor512Bytes: 1 * 3 * 512 * 512 * 4,
  }
}

export function markSafariBatchInterrupt(detail: {
  runId: string
  queued: number
  completed: number
  failed: number
  currentOrdinal?: number
}): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      INTERRUPT_KEY,
      JSON.stringify({ ...detail, wall: wallMs() }),
    )
  } catch {
    // ignore
  }
}

export function clearSafariBatchInterrupt(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(INTERRUPT_KEY)
  } catch {
    // ignore
  }
}

export type SafariBatchInterrupt = {
  runId: string
  queued: number
  completed: number
  failed: number
  currentOrdinal?: number
  wall: number
}

export function readSafariBatchInterrupt(): SafariBatchInterrupt | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(INTERRUPT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SafariBatchInterrupt
    if (!parsed?.runId) return null
    return parsed
  } catch {
    return null
  }
}

export function readSafariBatchDiagSnapshot(): {
  runId: string | null
  events: SafariDiagEvent[]
} | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { runId: string | null; events: SafariDiagEvent[] }
  } catch {
    return null
  }
}

/**
 * Attach page lifecycle listeners once. Distinguishes bfcache restore from a
 * cold reload; does NOT by itself prove memory-pressure kills.
 */
export function attachSafariBatchLifecycleListeners(): () => void {
  if (typeof window === 'undefined' || lifecycleAttached) {
    return () => undefined
  }
  lifecycleAttached = true

  const onVis = () => {
    logSafariDiag('lifecycle', 'visibilitychange', {
      visibilityState: document.visibilityState,
    })
  }
  const onPageHide = (ev: PageTransitionEvent) => {
    logSafariDiag('lifecycle', 'pagehide', {
      persisted: ev.persisted,
    })
  }
  const onPageShow = (ev: PageTransitionEvent) => {
    logSafariDiag('lifecycle', 'pageshow', {
      persisted: ev.persisted,
    })
  }
  const onBeforeUnload = () => {
    logSafariDiag('lifecycle', 'beforeunload')
  }

  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('beforeunload', onBeforeUnload)

  // Navigation timing (reload vs navigate) — evidence for full reload vs remount.
  try {
    const nav = performance.getEntriesByType?.(
      'navigation',
    )?.[0] as PerformanceNavigationTiming | undefined
    if (nav) {
      logSafariDiag('lifecycle', 'navigation_timing', {
        type: nav.type,
        transferSize: nav.transferSize,
      })
    }
  } catch {
    // ignore
  }

  return () => {
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('beforeunload', onBeforeUnload)
    lifecycleAttached = false
  }
}

/** Yield so Safari can reclaim decode/canvas memory between images. */
export async function yieldForSafariMemoryPressure(): Promise<void> {
  // Prefer timers over rAF: jsdom (and some WebViews) never flush rAF without
  // a paint loop, which would stall the batch after the first image.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 16)
  })
}
