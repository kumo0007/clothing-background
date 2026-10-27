import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the Safari peak-memory regressions that contributed to WebContent
 * kills during Start Auto-mask all (7 clothing photos).
 */
describe('Safari batch memory regressions (source contracts)', () => {
  const root = process.cwd()

  it('autoMaskCorners does not pre-decode ImageData or warm HTMLImage before segment', () => {
    const source = readFileSync(
      join(root, 'src/lib/batch/autoMaskCorners.ts'),
      'utf8',
    )
    expect(source).toMatch(/segmentWithBirefNet/)
    expect(source).not.toMatch(/getOrCreateMask\(/)
    expect(source).not.toMatch(/decodeSourceImageData/)
    expect(source).not.toMatch(/imageDataFromObjectUrl/)
    // loadHtmlImage only allowed in the File-missing fallback path.
    expect(source).toMatch(/Prefer the original File/)
  })

  it('App batch path stays concurrency 1 and yields only on Apple mobile', () => {
    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/const concurrency = 1/)
    expect(app).toMatch(/yieldForSafariMemoryPressure/)
    expect(app).toMatch(/if \(appleMobile\)/)
    expect(app).toMatch(/markSafariBatchInterrupt/)
    expect(app).toMatch(/startSafariBatchRun/)
    expect(app).toMatch(/discarded stale mask write/)
    expect(app).toMatch(/not a batch resume|not resumed/i)
    // Unmount must not wipe uploads (Strict Mode / remount hazard).
    expect(app).toMatch(/Do NOT revoke object URLs or clearAllMasks here/)
  })

  it('App does not auto location.reload on batch errors', () => {
    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/location\.reload/)
    expect(app).not.toMatch(/location\.href\s*=/)
  })
})
