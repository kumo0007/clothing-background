import { describe, expect, it } from 'vitest'
import {
  classifyInitMessage,
  formatInitProgressLine,
  getBgRemoveTimingSnapshot,
  noteBgRemoveInitProgress,
  noteBgRemoveProcessMs,
  noteBgRemoveReady,
  resetBgRemoveTimingForTests,
} from './bgRemoveTiming'

describe('bgRemoveTiming', () => {
  it('classifies download vs load messages for progress copy', () => {
    expect(classifyInitMessage('Downloading onnx/model_fp16.onnx…')).toBe(
      'download',
    )
    expect(classifyInitMessage('Loading model (WEBGPU)…')).toBe('load')
    expect(formatInitProgressLine('Downloading x', 0.5)).toMatch(
      /Downloading model weights/,
    )
    expect(formatInitProgressLine('Downloading x', 0.5)).toMatch(/50%/)
  })

  it('records ready and process aggregates without inventing success', () => {
    resetBgRemoveTimingForTests()
    noteBgRemoveInitProgress('Downloading…', 0.1)
    noteBgRemoveReady()
    noteBgRemoveProcessMs(1200)
    noteBgRemoveProcessMs(800)
    const snap = getBgRemoveTimingSnapshot()
    expect(snap.readyAt).not.toBeNull()
    expect(snap.processCount).toBe(2)
    expect(snap.totalProcessMs).toBe(2000)
    expect(snap.lastProcessMs).toBe(800)
  })
})
