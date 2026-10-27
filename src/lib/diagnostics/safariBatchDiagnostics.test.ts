import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearSafariBatchInterrupt,
  endSafariBatchRun,
  estimateImageBuffersBytes,
  logSafariDiag,
  markSafariBatchInterrupt,
  readSafariBatchDiagSnapshot,
  readSafariBatchInterrupt,
  startSafariBatchRun,
  yieldForSafariMemoryPressure,
} from './safariBatchDiagnostics'

describe('safariBatchDiagnostics', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearSafariBatchInterrupt()
  })

  afterEach(() => {
    sessionStorage.clear()
    clearSafariBatchInterrupt()
  })

  it('estimates buffer sizes without claiming Safari heap', () => {
    const est = estimateImageBuffersBytes(1000, 800)
    expect(est.rgbaBytes).toBe(1000 * 800 * 4)
    expect(est.maskBytes).toBe(1000 * 800)
    expect(est.tensor512Bytes).toBe(1 * 3 * 512 * 512 * 4)
  })

  it('persists a bounded event log and interrupt marker', () => {
    const runId = startSafariBatchRun('test')
    logSafariDiag('image_running', undefined, { ordinal: 1 })
    markSafariBatchInterrupt({
      runId,
      queued: 7,
      completed: 0,
      failed: 0,
      currentOrdinal: 1,
    })
    const snap = readSafariBatchDiagSnapshot()
    expect(snap?.runId).toBe(runId)
    expect(snap?.events.some((e) => e.kind === 'batch_start')).toBe(true)
    expect(readSafariBatchInterrupt()?.queued).toBe(7)
    endSafariBatchRun(true, { successCount: 1 })
    expect(readSafariBatchInterrupt()).toBeNull()
  })

  it('interrupt marker does not encode image pixels or claim resume capability', () => {
    markSafariBatchInterrupt({
      runId: 'r1',
      queued: 7,
      completed: 3,
      failed: 1,
    })
    const raw = sessionStorage.getItem('garment.safariBatchInterrupt.v1')
    expect(raw).toBeTruthy()
    expect(raw).not.toMatch(/data:image|Uint8|RGBA|blob:/i)
    expect(readSafariBatchInterrupt()?.completed).toBe(3)
  })

  it('yieldForSafariMemoryPressure resolves', async () => {
    await expect(yieldForSafariMemoryPressure()).resolves.toBeUndefined()
  })
})
