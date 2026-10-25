/**
 * Phase timings for local RMBG init / inference (diagnostics only).
 * Separates download wall time from ready and per-image process time.
 */

export type BgRemoveTimingSnapshot = {
  /** First download/init activity observed (ms, performance.now). */
  initStartedAt: number | null
  /** Model reported ready (ms). */
  readyAt: number | null
  /** Last completed process() duration (ms). */
  lastProcessMs: number | null
  /** Sum of process() durations this page session. */
  totalProcessMs: number
  processCount: number
  /** Last init progress message (download % etc.). */
  lastInitMessage: string | null
  lastInitRatio: number | null
}

const timing: BgRemoveTimingSnapshot = {
  initStartedAt: null,
  readyAt: null,
  lastProcessMs: null,
  totalProcessMs: 0,
  processCount: 0,
  lastInitMessage: null,
  lastInitRatio: null,
}

export function resetBgRemoveTimingForTests(): void {
  timing.initStartedAt = null
  timing.readyAt = null
  timing.lastProcessMs = null
  timing.totalProcessMs = 0
  timing.processCount = 0
  timing.lastInitMessage = null
  timing.lastInitRatio = null
}

export function noteBgRemoveInitProgress(message?: string, ratio?: number): void {
  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (timing.initStartedAt == null) {
    timing.initStartedAt = now
  }
  if (message !== undefined) timing.lastInitMessage = message
  if (typeof ratio === 'number') timing.lastInitRatio = ratio
}

export function noteBgRemoveReady(): void {
  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (timing.initStartedAt == null) timing.initStartedAt = now
  timing.readyAt = now
}

export function noteBgRemoveProcessMs(elapsedMs: number): void {
  timing.lastProcessMs = elapsedMs
  timing.totalProcessMs += elapsedMs
  timing.processCount += 1
}

export function getBgRemoveTimingSnapshot(): BgRemoveTimingSnapshot {
  return { ...timing }
}

/** Classify SDK init messages for operator-facing progress copy. */
export function classifyInitMessage(
  message: string | undefined,
): 'download' | 'load' | 'other' {
  if (!message) return 'other'
  if (/download/i.test(message)) return 'download'
  if (/load/i.test(message)) return 'load'
  return 'other'
}

export function formatInitProgressLine(
  message: string | undefined,
  ratio: number | undefined,
): string {
  const pct =
    typeof ratio === 'number' ? ` (${Math.round(ratio * 100)}%)` : ''
  const kind = classifyInitMessage(message)
  if (kind === 'download') {
    return `Downloading model weights${message ? `: ${message}` : ''}${pct}`
  }
  if (kind === 'load') {
    return `Initializing on-device model${message ? `: ${message}` : ''}${pct}`
  }
  return `Preparing model${message ? `: ${message}` : ''}${pct}`
}
