import { describe, expect, it } from 'vitest'
import { checkBootCompat, formatBootCompatBanner } from './bootCompat'

describe('checkBootCompat', () => {
  it('passes in a normal jsdom-like environment with Worker', () => {
    const result = checkBootCompat({
      document: { getElementById: () => null } as unknown as Document,
      navigator: {} as Navigator,
      Worker: function Worker() {} as unknown as typeof Worker,
      OffscreenCanvas: function OffscreenCanvas() {} as unknown as typeof OffscreenCanvas,
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('warns when Worker is missing without failing boot', () => {
    const result = checkBootCompat({
      document: { getElementById: () => null } as unknown as Document,
      navigator: {} as Navigator,
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => /Web Workers/i.test(w))).toBe(true)
    expect(formatBootCompatBanner(result.warnings)).toMatch(/Web Workers/i)
  })

  it('fails closed only when DOM is missing', () => {
    const result = checkBootCompat({
      document: undefined as unknown as Document,
      navigator: {} as Navigator,
    })
    expect(result.ok).toBe(false)
  })
})
