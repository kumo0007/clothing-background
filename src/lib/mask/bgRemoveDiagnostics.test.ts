import { describe, expect, it } from 'vitest'
import {
  classifyBgRemoveFailure,
  formatSdkProcessStage,
  getBgRemoveDiagnosticSnapshot,
  noteBgRemoveDiagnostic,
  resetBgRemoveDiagnosticsForTests,
} from './bgRemoveDiagnostics'

describe('bgRemoveDiagnostics', () => {
  it('classifies timeout and init failures', () => {
    expect(
      classifyBgRemoveFailure('Local inference timed out after 120s.'),
    ).toBe('timeout-process')
    expect(
      classifyBgRemoveFailure('Model download timed out after 180s.'),
    ).toBe('timeout-init')
    expect(classifyBgRemoveFailure('Model init failed (network)')).toBe('init')
  })

  it('maps Running model… to operator-facing copy', () => {
    expect(formatSdkProcessStage('Running model…')).toMatch(
      /on-device inference/i,
    )
  })

  it('stores sanitized events only', () => {
    resetBgRemoveDiagnosticsForTests()
    noteBgRemoveDiagnostic({
      type: 'process_start',
      device: 'wasm',
      width: 1600,
      height: 1200,
      detail: 'downscaled-input',
    })
    const snap = getBgRemoveDiagnosticSnapshot()
    expect(snap.lastDevice).toBe('wasm')
    expect(snap.events).toHaveLength(1)
    expect(JSON.stringify(snap)).not.toMatch(/data:image|base64|Bearer/i)
  })
})
