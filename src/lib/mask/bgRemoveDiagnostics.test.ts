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
      classifyBgRemoveFailure(
        'Model download timed out (no progress for 180s, or over 600s total).',
      ),
    ).toBe('timeout-init')
    expect(classifyBgRemoveFailure('Model init failed (network)')).toBe('init')
    expect(
      classifyBgRemoveFailure(
        'no available backend found. ERR: [wasm] RangeError: Out of memory',
      ),
    ).toBe('init-oom')
    expect(classifyBgRemoveFailure('Load failed')).toBe('download')
    expect(classifyBgRemoveFailure('TypeError: Load failed')).toBe('download')
    expect(
      classifyBgRemoveFailure(
        'NetworkError when attempting to fetch resource.',
      ),
    ).toBe('download')
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
