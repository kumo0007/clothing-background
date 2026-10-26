/**
 * Privacy-safe diagnostics for on-device RMBG init / inference.
 * Never logs image bytes, filenames with PII assumptions beyond stage labels,
 * credentials, or env values.
 */

export type BgRemoveFailureStage =
  | 'init'
  | 'init-oom'
  | 'download'
  | 'session'
  | 'process'
  | 'decode'
  | 'timeout-init'
  | 'timeout-process'
  | 'cancelled'
  | 'unknown'

export type BgRemoveDiagnosticEvent = {
  at: number
  type:
    | 'init_start'
    | 'init_progress'
    | 'init_ready'
    | 'init_error'
    | 'backend_select'
    | 'backend_fallback'
    | 'init_stage'
    | 'process_start'
    | 'process_progress'
    | 'process_done'
    | 'process_error'
    | 'recover_worker'
  /** Sanitized category — no raw env or image payloads. */
  detail?: string
  device?: 'webgpu' | 'wasm' | 'unknown'
  width?: number
  height?: number
  elapsedMs?: number
  failureStage?: BgRemoveFailureStage
}

const MAX_EVENTS = 40
const events: BgRemoveDiagnosticEvent[] = []
let lastDevice: 'webgpu' | 'wasm' | 'unknown' | null = null
let lastFailureStage: BgRemoveFailureStage | null = null

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function resetBgRemoveDiagnosticsForTests(): void {
  events.length = 0
  lastDevice = null
  lastFailureStage = null
}

export function noteBgRemoveDiagnostic(event: Omit<BgRemoveDiagnosticEvent, 'at'>): void {
  const entry: BgRemoveDiagnosticEvent = { at: now(), ...event }
  events.push(entry)
  if (events.length > MAX_EVENTS) events.shift()
  if (event.device) lastDevice = event.device
  if (event.failureStage) lastFailureStage = event.failureStage

  // Operator console only — no image content.
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[bgRemove]', event.type, event.detail ?? '', {
      device: event.device,
      dims:
        event.width != null && event.height != null
          ? `${event.width}x${event.height}`
          : undefined,
      elapsedMs: event.elapsedMs,
      failureStage: event.failureStage,
    })
  }
}

export function getBgRemoveDiagnosticSnapshot(): {
  events: readonly BgRemoveDiagnosticEvent[]
  lastDevice: 'webgpu' | 'wasm' | 'unknown' | null
  lastFailureStage: BgRemoveFailureStage | null
} {
  return {
    events: [...events],
    lastDevice,
    lastFailureStage,
  }
}

/** Classify SDK init progress strings into allocation stages (no PII). */
export function classifyInitProgressStage(
  message: string | undefined,
): 'download' | 'session' | 'runtime' | 'other' {
  const m = (message ?? '').trim()
  if (/Downloading/i.test(m)) return 'download'
  if (/Initializing runtime|Loading model/i.test(m)) return 'runtime'
  if (/Loaded |ready/i.test(m)) return 'session'
  return 'other'
}

/** Map raw Error messages to a coarse failure stage (no PII). */
export function classifyBgRemoveFailure(message: string): BgRemoveFailureStage {
  if (/timed out.*download|Model download timed out/i.test(message)) {
    return 'timeout-init'
  }
  if (/timed out.*inference|Local inference timed out/i.test(message)) {
    return 'timeout-process'
  }
  if (/^Load failed$/i.test(message) || /TypeError:\s*Load failed/i.test(message)) {
    return 'download'
  }
  if (
    /Out of memory|OOM/i.test(message) &&
    (/\[wasm\]|no available backend|Model init|backend/i.test(message) ||
      /RangeError/i.test(message))
  ) {
    return 'init-oom'
  }
  if (
    /no available backend|Importing a module script failed|webgpu/i.test(
      message,
    ) &&
    /init|backend|module|Model init/i.test(message)
  ) {
    return 'init'
  }
  if (/Model init failed|download|backend/i.test(message)) return 'init'
  if (/Out of memory|memory/i.test(message)) return 'process'
  if (/cancel|disposed|reloaded/i.test(message)) return 'cancelled'
  if (/decode|Invalid source|Empty image/i.test(message)) return 'decode'
  return 'unknown'
}

/** Friendlier process-stage labels for UI (SDK sends “Running model…” etc.). */
export function formatSdkProcessStage(stage: string): string {
  const s = stage.trim()
  if (/^Running model/i.test(s)) {
    return 'Running on-device inference…'
  }
  if (/^Preparing/i.test(s)) return 'Preparing image for inference…'
  if (/^Composing/i.test(s)) return 'Composing mask output…'
  return s
}
